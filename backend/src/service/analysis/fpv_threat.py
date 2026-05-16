"""FPV drone threat areas.

Pure-compute derivative that combines two cached datasets to produce an
FPV-drone threat raster for the AoI:

  - Forest cover (NLS metsamaankasvillisuus, vector polygons) → forest mask
  - Weather forecast (Open-Meteo grid, Parquet) → wind speed per grid point

Classification rules (per cell):
  - Dense forest cover                 → no threat (transparent)
  - Wind speed ≥ _WIND_MAX_MS          → no threat (transparent)
  - Wind speed < _WIND_LOW_MS          → HIGH threat (dark blue)
  - _WIND_LOW_MS ≤ wind < _WIND_MID_MS → MODERATE threat (medium blue)
  - _WIND_MID_MS ≤ wind < _WIND_MAX_MS → LOW threat (light blue)

The wind value at each pixel is taken from the nearest forecast grid
point (great-circle nearest in lat/lon space). The forecast hour used is
the earliest available time step (operational "now" view).

This service does not call external APIs. It reads cached datasets and
writes a single derived PNG + meta for the AoI.

Output files:
    {aoi_id}/derived/fpv_threat.png
    {aoi_id}/derived/meta.json (shared with other derived layers)
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image
from rasterio.features import rasterize
from rasterio.transform import from_bounds
from shapely.geometry import shape

from src.service._shared.bbox import BBox
from src.service._shared.storage import (
    category_file,
    ensure_dir,
    read_json,
    write_category_meta,
)

logger = logging.getLogger(__name__)

# FPV drones (small quadcopters) typical wind tolerance:
#   - Below 4 m/s: full operational envelope → highest threat
#   - 4–8 m/s: degraded handling, payload accuracy drops
#   - 8–12 m/s: only experienced pilots, marginal threat
#   - Above 12 m/s: outside operational envelope → no threat
_WIND_LOW_MS = 4.0
_WIND_MID_MS = 8.0
_WIND_MAX_MS = 12.0

# Output raster size (long axis, in pixels). Forest polygons render fine at
# this resolution; the wind grid is coarse (~9 km spacing) so the
# nearest-neighbour lookup doesn't need more pixels than this.
_MAX_SIDE_PX = 1024
_MIN_SIDE_PX = 512

# RGBA palette (R, G, B, A). Threat is encoded by alpha-weighted shade of
# blue — darker / more opaque = higher threat.
_COLOR_NONE = (0, 0, 0, 0)                 # forest or wind out of envelope
_COLOR_HIGH = (10, 30, 110, 210)           # dark blue
_COLOR_MODERATE = (60, 110, 190, 180)      # medium blue
_COLOR_LOW = (140, 180, 230, 140)          # light blue

# Forest classification — mirrors analysis/movement_corridors.py and
# analysis/mcoo.py so the three derivatives stay consistent.
_FOREST_KEYWORDS = (
    "forest", "wood", "woodland", "conifer", "deciduous", "mixed",
    "mets", "metsa",
)
_DENSE_KEYWORDS = (
    "dense", "thick", "closed", "tihea",
)


def _props_text(props: dict | None) -> str:
    if not props:
        return ""
    return " ".join(str(v).lower() for v in props.values() if v is not None)


def _is_dense_forest(props: dict) -> bool:
    text = _props_text(props)
    if not any(k in text for k in _FOREST_KEYWORDS):
        return False
    if any(k in text for k in _DENSE_KEYWORDS):
        return True
    return any(k in text for k in ("forest", "metsa", "mets", "wood"))


def _raster_size(bbox: BBox) -> tuple[int, int]:
    lon_span = max(abs(bbox.max_lon - bbox.min_lon), 1e-9)
    lat_span = max(abs(bbox.max_lat - bbox.min_lat), 1e-9)
    aspect = lon_span / lat_span
    if aspect >= 1:
        width = _MAX_SIDE_PX
        height = max(_MIN_SIDE_PX, int(round(_MAX_SIDE_PX / aspect)))
    else:
        height = _MAX_SIDE_PX
        width = max(_MIN_SIDE_PX, int(round(_MAX_SIDE_PX * aspect)))
    return width, height


def _build_forest_mask(
    features: list[dict],
    bbox: BBox,
    width: int,
    height: int,
) -> np.ndarray:
    """Rasterize dense-forest polygons (4326) onto a (height, width) grid
    covering the AoI bbox. Returns a uint8 mask (1 = forest, 0 = open)."""
    shapes: list[tuple[dict, int]] = []
    for feature in features:
        geom = feature.get("geometry")
        if not geom:
            continue
        try:
            geom_obj = shape(geom)
        except Exception:
            continue
        if geom_obj.is_empty:
            continue
        shapes.append((geom, 1))

    if not shapes:
        return np.zeros((height, width), dtype="uint8")

    transform = from_bounds(
        bbox.min_lon, bbox.min_lat, bbox.max_lon, bbox.max_lat, width, height,
    )
    return rasterize(
        shapes,
        out_shape=(height, width),
        transform=transform,
        fill=0,
        all_touched=True,
        dtype="uint8",
    )


def _load_wind_points(parquet_path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray, str | None]:
    """Read forecast.parquet and return (lons, lats, wind_ms, valid_time_used).

    Uses the earliest available forecast hour as the operational "now"
    snapshot. If wind_speed_ms is NaN for a point at that hour, that point
    is skipped (its area will fall back to the next-nearest grid point).
    """
    df = pd.read_parquet(parquet_path)
    if df.empty or not {"lon", "lat", "valid_time", "wind_speed_ms"} <= set(df.columns):
        return np.empty(0), np.empty(0), np.empty(0), None

    df = df.copy()
    df["valid_time"] = pd.to_datetime(df["valid_time"], utc=True, errors="coerce")
    df = df.dropna(subset=["valid_time", "wind_speed_ms"])
    if df.empty:
        return np.empty(0), np.empty(0), np.empty(0), None

    first_time = df["valid_time"].min()
    snap = df[df["valid_time"] == first_time]

    lons = snap["lon"].to_numpy(dtype="float64")
    lats = snap["lat"].to_numpy(dtype="float64")
    wind = snap["wind_speed_ms"].to_numpy(dtype="float32")
    return lons, lats, wind, first_time.isoformat()


def _nearest_wind_grid(
    bbox: BBox,
    width: int,
    height: int,
    pt_lons: np.ndarray,
    pt_lats: np.ndarray,
    pt_wind: np.ndarray,
) -> np.ndarray:
    """For each pixel of the output raster, return the wind speed of the
    nearest forecast grid point. Returns a (height, width) float32 array.
    All-NaN if no points are available."""
    if pt_lons.size == 0:
        return np.full((height, width), np.nan, dtype="float32")

    lon_step = (bbox.max_lon - bbox.min_lon) / max(width, 1)
    lat_step = (bbox.max_lat - bbox.min_lat) / max(height, 1)
    pixel_lons = bbox.min_lon + (np.arange(width) + 0.5) * lon_step
    # Image row 0 is the top (max_lat), row height-1 is the bottom (min_lat).
    pixel_lats = bbox.max_lat - (np.arange(height) + 0.5) * lat_step

    # Squared planar distance is sufficient for nearest-neighbour over a
    # small AoI — wind grid spacing (~9 km) is much larger than the
    # latitude/longitude scaling error at Finnish latitudes.
    # Shape: (H, W, N) would blow memory for large grids — iterate per point.
    best_dist = np.full((height, width), np.inf, dtype="float32")
    best_val = np.full((height, width), np.nan, dtype="float32")
    lon2 = pixel_lons[np.newaxis, :]
    lat2 = pixel_lats[:, np.newaxis]
    for lon, lat, val in zip(pt_lons, pt_lats, pt_wind):
        if not np.isfinite(val):
            continue
        d = (lon2 - lon) ** 2 + (lat2 - lat) ** 2
        mask = d < best_dist
        best_dist[mask] = d[mask]
        best_val[mask] = float(val)
    return best_val


def _classify_to_rgba(
    forest_mask: np.ndarray,
    wind_ms: np.ndarray,
) -> np.ndarray:
    h, w = forest_mask.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)

    valid = np.isfinite(wind_ms)
    open_ground = valid & (forest_mask == 0)

    high = open_ground & (wind_ms < _WIND_LOW_MS)
    moderate = open_ground & (wind_ms >= _WIND_LOW_MS) & (wind_ms < _WIND_MID_MS)
    low = open_ground & (wind_ms >= _WIND_MID_MS) & (wind_ms < _WIND_MAX_MS)

    rgba[high] = _COLOR_HIGH
    rgba[moderate] = _COLOR_MODERATE
    rgba[low] = _COLOR_LOW
    # Forest, no-wind-data, and wind ≥ _WIND_MAX_MS all stay (0,0,0,0).
    return rgba


def _empty_png(out_path: Path) -> None:
    image = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    ensure_dir(out_path.parent)
    image.save(out_path)


def build_fpv_threat(aoi_id: str, bbox: BBox) -> dict:
    """Compute the FPV-drone threat-areas PNG for the AoI.

    Returns a summary dict. The PNG is written to
    {aoi_id}/derived/fpv_threat.png.
    """
    out_path = category_file(aoi_id, "derived", "fpv_threat.png")
    ensure_dir(out_path.parent)

    land_cover = category_file(aoi_id, "land", "cover.geojson")
    forecast = category_file(aoi_id, "weather", "forecast.parquet")

    missing = [p.name for p in (land_cover, forecast) if not p.exists()]
    if missing:
        logger.warning("fpv_threat: missing inputs %s", missing)
        _empty_png(out_path)
        write_category_meta(
            aoi_id, "derived",
            source="Derived FPV threat areas",
            confidence="low",
            feature_counts={"missing_inputs": len(missing)},
        )
        return {"status": "missing_inputs", "missing": missing}

    width, height = _raster_size(bbox)
    logger.info(
        "fpv_threat: raster %dx%d (bbox %.4f,%.4f → %.4f,%.4f)",
        width, height,
        bbox.min_lon, bbox.min_lat, bbox.max_lon, bbox.max_lat,
    )

    cover = read_json(land_cover) or {}
    cover_features = cover.get("features", []) if isinstance(cover, dict) else []
    dense_forest = [f for f in cover_features if _is_dense_forest(f.get("properties") or {})]
    forest_mask = _build_forest_mask(dense_forest, bbox, width, height)

    pt_lons, pt_lats, pt_wind, time_used = _load_wind_points(forecast)
    wind_ms = _nearest_wind_grid(bbox, width, height, pt_lons, pt_lats, pt_wind)

    rgba = _classify_to_rgba(forest_mask, wind_ms)
    Image.fromarray(rgba, mode="RGBA").save(out_path)

    counts = {
        "cells_total": int(width * height),
        "cells_forest": int((forest_mask > 0).sum()),
        "cells_high": int(((wind_ms < _WIND_LOW_MS) & (forest_mask == 0)).sum()),
        "cells_moderate": int(
            ((wind_ms >= _WIND_LOW_MS) & (wind_ms < _WIND_MID_MS) & (forest_mask == 0)).sum()
        ),
        "cells_low": int(
            ((wind_ms >= _WIND_MID_MS) & (wind_ms < _WIND_MAX_MS) & (forest_mask == 0)).sum()
        ),
        "wind_grid_points": int(pt_lons.size),
    }
    write_category_meta(
        aoi_id, "derived",
        source="Derived FPV threat areas",
        confidence="high" if pt_lons.size > 0 else "low",
        feature_counts=counts,
    )
    logger.info("fpv_threat: %s (forecast hour: %s)", counts, time_used)
    return {
        "source": "Derived FPV threat areas",
        "counts": counts,
        "forecast_hour": time_used,
    }
