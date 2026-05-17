"""FPV drone threat areas.

Pure-compute derivative that combines two cached datasets to produce an
FPV-drone threat raster stack covering the next 72 forecast hours:

    - Forest cover (NLS land/forest.geojson, pre-filtered to forest polygons
      by service/nls/land.py — same file consumed by movement_corridors.py)
      → forest mask, treated as no threat (canopy hides FPVs)
    - Weather forecast (Open-Meteo grid, Parquet) → wind speed per grid point

Classification rules (per cell):
    - Forest cover                       → hidden under canopy (transparent)
    - Wind speed ≥ _WIND_MAX_MS          → no possibility (red — drone out of envelope)
    - Wind speed < _WIND_LOW_MS          → HIGH threat (dark blue)
    - _WIND_LOW_MS ≤ wind < _WIND_MID_MS → MODERATE threat (medium blue)
    - _WIND_MID_MS ≤ wind < _WIND_MAX_MS → LOW threat (light blue)

The nearest wind-grid lookup depends only on the AoI and forecast grid
geometry, so it is built once and reused for every forecast timestep.

The forecast loop emits one raster per hour for the next 72 hours, matching
the upstream `forecast_days: 3` Open-Meteo horizon. Past timesteps are
dropped so the front-end timeline only ever animates over future state.

This service does not call external APIs. It reads cached datasets and
writes a time-indexed PNG stack plus a default "now" PNG for the AoI.

Output files:
        {aoi_id}/derived/fpv_threat.png
        {aoi_id}/derived/fpv_threat/<timestamp>.png
        {aoi_id}/derived/fpv_threat_manifest.json
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
    category_dir,
    category_file,
    ensure_dir,
    read_json,
    write_category_meta,
    write_json,
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

# RGBA palette (R, G, B, A). Blue shades = drone is able to operate; darker /
# more opaque = higher threat. Red = drone outside operational envelope (no
# possibility). Forest cells stay transparent because the canopy hides
# whatever is underneath rather than ruling drones out.
_COLOR_NONE = (0, 0, 0, 0)                 # forest canopy — hidden
_COLOR_HIGH = (10, 30, 110, 210)           # dark blue
_COLOR_MODERATE = (60, 110, 190, 180)      # medium blue
_COLOR_LOW = (140, 180, 230, 140)          # light blue
_COLOR_NO_POSSIBILITY = (210, 55, 55, 215) # red — wind exceeds drone envelope

# Forecast horizon covered by the persisted stack. Matches the
# `forecast_days: 3` window the weather service requests from Open-Meteo —
# we emit one raster per future hour up to this cap.
_FORECAST_HOURS = 72

_STACK_DIRNAME = "fpv_threat"
_MANIFEST_FILENAME = "fpv_threat_manifest.json"
_IDW_NEIGHBOURS = 4
_IDW_POWER = 2.0
_IDW_EPS = 1e-6


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


def _manifest_path(aoi_id: str) -> Path:
    return category_file(aoi_id, "derived", _MANIFEST_FILENAME)


def _stack_dir(aoi_id: str) -> Path:
    return category_dir(aoi_id, "derived") / _STACK_DIRNAME


def _stack_raster_path(aoi_id: str, filename: str) -> Path:
    return _stack_dir(aoi_id) / filename


def _timestamp_slug(valid_time: str) -> str:
    ts = pd.to_datetime(valid_time, utc=True, errors="coerce")
    if pd.isna(ts):
        return "unknown"
    return ts.strftime("%Y%m%dT%H%M%SZ")


def _load_forecast_stack(
    parquet_path: Path,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[str]]:
    """Return (point_lons, point_lats, wind_by_time_and_point, valid_times)."""
    df = pd.read_parquet(parquet_path)
    if df.empty or not {"lon", "lat", "valid_time", "wind_speed_ms"} <= set(df.columns):
        return np.empty(0), np.empty(0), np.empty((0, 0), dtype="float32"), []

    df = df.copy()
    df["valid_time"] = pd.to_datetime(df["valid_time"], utc=True, errors="coerce")
    df = df.dropna(subset=["valid_time"])
    if df.empty:
        return np.empty(0), np.empty(0), np.empty((0, 0), dtype="float32"), []

    point_df = (
        df[["lon", "lat"]]
        .drop_duplicates()
        .sort_values(["lat", "lon"])
        .reset_index(drop=True)
    )
    valid_times_ts = list(df["valid_time"].drop_duplicates().sort_values())
    valid_times = [ts.isoformat() for ts in valid_times_ts]
    point_count = len(point_df)
    wind_stack = np.full((len(valid_times), point_count), np.nan, dtype="float32")

    point_index = {
        (float(row.lon), float(row.lat)): int(idx)
        for idx, row in point_df.iterrows()
    }
    time_index = {ts.value: idx for idx, ts in enumerate(valid_times_ts)}

    for row in df[["lon", "lat", "valid_time", "wind_speed_ms"]].itertuples(index=False):
        point_idx = point_index.get((float(row.lon), float(row.lat)))
        time_idx = time_index.get(row.valid_time.value)
        if point_idx is None or time_idx is None or pd.isna(row.wind_speed_ms):
            continue
        wind_stack[time_idx, point_idx] = float(row.wind_speed_ms)

    return (
        point_df["lon"].to_numpy(dtype="float64"),
        point_df["lat"].to_numpy(dtype="float64"),
        wind_stack,
        valid_times,
    )


def _idw_lookup_tables(
    bbox: BBox,
    width: int,
    height: int,
    pt_lons: np.ndarray,
    pt_lats: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Precompute nearest-neighbour indices+weights for IDW interpolation."""
    if pt_lons.size == 0:
        return (
            np.full((1, height, width), -1, dtype="int32"),
            np.zeros((1, height, width), dtype="float32"),
        )

    lon_step = (bbox.max_lon - bbox.min_lon) / max(width, 1)
    lat_step = (bbox.max_lat - bbox.min_lat) / max(height, 1)
    pixel_lons = bbox.min_lon + (np.arange(width) + 0.5) * lon_step
    # Image row 0 is the top (max_lat), row height-1 is the bottom (min_lat).
    pixel_lats = bbox.max_lat - (np.arange(height) + 0.5) * lat_step

    # Squared planar distance is sufficient for a small AoI and sparse grid.
    k = max(1, min(_IDW_NEIGHBOURS, int(pt_lons.size)))
    best_dist = np.full((k, height, width), np.inf, dtype="float32")
    best_idx = np.full((k, height, width), -1, dtype="int32")
    lon2 = pixel_lons[np.newaxis, :]
    lat2 = pixel_lats[:, np.newaxis]

    for idx, (lon, lat) in enumerate(zip(pt_lons, pt_lats)):
        cand_dist = ((lon2 - lon) ** 2 + (lat2 - lat) ** 2).astype("float32")
        cand_idx = np.full((height, width), idx, dtype="int32")
        for slot in range(k):
            mask = cand_dist < best_dist[slot]
            if not mask.any():
                continue
            old_dist = best_dist[slot][mask].copy()
            old_idx = best_idx[slot][mask].copy()
            best_dist[slot][mask] = cand_dist[mask]
            best_idx[slot][mask] = cand_idx[mask]
            cand_dist[mask] = old_dist
            cand_idx[mask] = old_idx

    weights = np.zeros_like(best_dist, dtype="float32")
    valid = best_idx >= 0
    if valid.any():
        inv = np.zeros_like(best_dist, dtype="float32")
        inv[valid] = 1.0 / np.power(best_dist[valid] + _IDW_EPS, _IDW_POWER * 0.5)
        denom = inv.sum(axis=0)
        nz = denom > 0
        if nz.any():
            weights[:, nz] = inv[:, nz] / denom[nz]
    return best_idx, weights


def _wind_grid_from_lookup(
    point_idx: np.ndarray,
    point_weights: np.ndarray,
    wind_by_point: np.ndarray,
) -> np.ndarray:
    _, height, width = point_idx.shape
    wind_ms = np.full((height, width), np.nan, dtype="float32")

    safe_idx = np.where(point_idx >= 0, point_idx, 0)
    neighbour_vals = wind_by_point[safe_idx]
    valid = (point_idx >= 0) & np.isfinite(neighbour_vals)
    if not valid.any():
        return wind_ms

    weighted = np.where(valid, neighbour_vals * point_weights, 0.0)
    sum_weights = np.where(valid, point_weights, 0.0).sum(axis=0)
    good = sum_weights > 0
    if good.any():
        wind_ms[good] = weighted.sum(axis=0)[good] / sum_weights[good]
    return wind_ms


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
    no_possibility = open_ground & (wind_ms >= _WIND_MAX_MS)

    rgba[high] = _COLOR_HIGH
    rgba[moderate] = _COLOR_MODERATE
    rgba[low] = _COLOR_LOW
    rgba[no_possibility] = _COLOR_NO_POSSIBILITY
    # Forest and no-wind-data stay (0,0,0,0).
    return rgba


def _empty_png(out_path: Path) -> None:
    image = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    ensure_dir(out_path.parent)
    image.save(out_path)


def _write_manifest(aoi_id: str, rasters: list[dict], default_valid_time: str | None) -> None:
    write_json(
        _manifest_path(aoi_id),
        {
            "default_valid_time": default_valid_time,
            "rasters": rasters,
        },
    )


def load_fpv_threat_manifest(aoi_id: str) -> dict | None:
    data = read_json(_manifest_path(aoi_id))
    return data if isinstance(data, dict) else None


def resolve_fpv_threat_raster(aoi_id: str, valid_time: str | None = None) -> Path | None:
    default_path = category_file(aoi_id, "derived", "fpv_threat.png")
    if valid_time is None:
        return default_path if default_path.exists() else None

    manifest = load_fpv_threat_manifest(aoi_id)
    if not isinstance(manifest, dict):
        return default_path if default_path.exists() else None

    rasters = manifest.get("rasters")
    if not isinstance(rasters, list) or not rasters:
        return default_path if default_path.exists() else None

    selected = None
    requested_ts = pd.to_datetime(valid_time, utc=True, errors="coerce")
    best_diff = None
    for entry in rasters:
        if not isinstance(entry, dict):
            continue
        entry_time = entry.get("valid_time")
        filename = entry.get("filename")
        if not isinstance(entry_time, str) or not isinstance(filename, str):
            continue
        if entry_time == valid_time:
            selected = entry
            break
        if pd.isna(requested_ts):
            continue
        entry_ts = pd.to_datetime(entry_time, utc=True, errors="coerce")
        if pd.isna(entry_ts):
            continue
        diff = abs((entry_ts - requested_ts).total_seconds())
        if best_diff is None or diff < best_diff:
            best_diff = diff
            selected = entry

    if selected is None:
        return default_path if default_path.exists() else None

    raster_path = _stack_raster_path(aoi_id, str(selected["filename"]))
    if raster_path.exists():
        return raster_path
    return default_path if default_path.exists() else None


def build_fpv_threat_stack(aoi_id: str, bbox: BBox) -> dict:
    """Compute and persist FPV-drone threat rasters for every forecast hour."""
    default_out_path = category_file(aoi_id, "derived", "fpv_threat.png")
    ensure_dir(default_out_path.parent)
    ensure_dir(_stack_dir(aoi_id))

    forest_path = category_file(aoi_id, "land", "forest.geojson")
    forecast = category_file(aoi_id, "weather", "forecast.parquet")

    missing = [p.name for p in (forest_path, forecast) if not p.exists()]
    if missing:
        logger.warning("fpv_threat: missing inputs %s", missing)
        _empty_png(default_out_path)
        _write_manifest(aoi_id, [], None)
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

    # Forest mask: read the pre-filtered land/forest.geojson (same input
    # movement_corridors.py uses). Every polygon here is already classified
    # as forest by service/nls/land.py, so we treat the whole file as the
    # canopy mask — no per-feature keyword sniffing, which was missing the
    # NLS coded properties (kohdeluokka etc.) and producing an empty mask.
    cover = read_json(forest_path) or {}
    forest_features = cover.get("features", []) if isinstance(cover, dict) else []
    forest_features = [f for f in forest_features if isinstance(f, dict) and f.get("geometry")]
    forest_mask = _build_forest_mask(forest_features, bbox, width, height)

    pt_lons, pt_lats, wind_stack, valid_times = _load_forecast_stack(forecast)
    point_idx, point_weights = _idw_lookup_tables(bbox, width, height, pt_lons, pt_lats)

    # Restrict the persisted stack to the next 72 forecast hours. The weather
    # service requests `forecast_days: 3` from Open-Meteo, so the parquet may
    # contain past hours from the start-of-day boundary; filter them out so
    # the front-end timeline only animates over future state.
    now_ts = pd.Timestamp.utcnow().tz_convert("UTC")
    horizon_ts = now_ts + pd.Timedelta(hours=_FORECAST_HOURS)
    kept_indices: list[int] = []
    kept_valid_times: list[str] = []
    for idx, valid_time in enumerate(valid_times):
        ts = pd.to_datetime(valid_time, utc=True, errors="coerce")
        if pd.isna(ts):
            continue
        if ts < now_ts - pd.Timedelta(minutes=30) or ts > horizon_ts:
            continue
        kept_indices.append(idx)
        kept_valid_times.append(valid_time)

    rasters: list[dict] = []
    for emit_idx, (idx, valid_time) in enumerate(zip(kept_indices, kept_valid_times)):
        wind_ms = _wind_grid_from_lookup(point_idx, point_weights, wind_stack[idx])
        rgba = _classify_to_rgba(forest_mask, wind_ms)
        filename = f"{_timestamp_slug(valid_time)}.png"
        Image.fromarray(rgba, mode="RGBA").save(_stack_raster_path(aoi_id, filename))
        if emit_idx == 0:
            Image.fromarray(rgba, mode="RGBA").save(default_out_path)
        rasters.append({
            "valid_time": valid_time,
            "filename": filename,
        })

    if not rasters:
        _empty_png(default_out_path)

    _write_manifest(aoi_id, rasters, rasters[0]["valid_time"] if rasters else None)

    counts = {
        "cells_total": int(width * height),
        "cells_forest": int((forest_mask > 0).sum()),
        "forest_polygons": int(len(forest_features)),
        "wind_grid_points": int(pt_lons.size),
        "time_steps": int(len(kept_valid_times)),
        "forecast_horizon_hours": _FORECAST_HOURS,
    }

    if kept_indices:
        first_wind = _wind_grid_from_lookup(point_idx, point_weights, wind_stack[kept_indices[0]])
        counts.update({
            "cells_high": int(((first_wind < _WIND_LOW_MS) & (forest_mask == 0)).sum()),
            "cells_moderate": int(
                ((first_wind >= _WIND_LOW_MS) & (first_wind < _WIND_MID_MS) & (forest_mask == 0)).sum()
            ),
            "cells_low": int(
                ((first_wind >= _WIND_MID_MS) & (first_wind < _WIND_MAX_MS) & (forest_mask == 0)).sum()
            ),
            "cells_no_possibility": int(
                ((first_wind >= _WIND_MAX_MS) & (forest_mask == 0)).sum()
            ),
        })

    write_category_meta(
        aoi_id, "derived",
        source="Derived FPV threat areas",
        confidence="high" if pt_lons.size > 0 else "low",
        feature_counts=counts,
    )
    logger.info(
        "fpv_threat: %s (forecast hours persisted: %d / %d)",
        counts,
        len(kept_valid_times),
        _FORECAST_HOURS,
    )
    return {
        "source": "Derived FPV threat areas",
        "counts": counts,
        "forecast_hour": kept_valid_times[0] if kept_valid_times else None,
        "time_steps": len(kept_valid_times),
    }


def build_fpv_threat(aoi_id: str, bbox: BBox) -> dict:
    """Backward-compatible wrapper that persists the full FPV threat stack."""
    return build_fpv_threat_stack(aoi_id, bbox)
