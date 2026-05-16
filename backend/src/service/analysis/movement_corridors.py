"""Movement corridors for heavy vehicles.

Combines cached datasets to produce a single trafficability raster:
  - DEM (NLS korkeusmalli_2m, EPSG:3067) → slope per cell
  - Forest cover (NLS land/forest.geojson, pre-filtered to forest polygons)
    → forest mask (treated as no-go for heavy tracked vehicles)
  - Water bodies + courses (NLS water/bodies.geojson, water/courses.geojson)
    → water mask (no-go, courses buffered ~15 m each side)
  - Roads (NLS tieviiva, vector lines) → road mask (overrides as go)

The grid is built in EPSG:3067 at 50 m resolution, classified per cell, then
reprojected to EPSG:4326 and cropped to the AoI bbox for map rendering.

Classification rules (heavy tracked vehicles, ~60 t MBT/IFV):
  - road within 25 m              → GO    (light blue, more opaque)
  - slope ≥ 20° OR forest OR water → NO-GO (red)
  - 10° ≤ slope < 20°             → UNSURE (fully transparent)
  - otherwise                     → GO    (light blue, translucent)

No external API calls — reads cached datasets from disk only.

Output files:
    {aoi_id}/derived/movement_corridors_heavy.png
    {aoi_id}/derived/meta.json
"""

from __future__ import annotations

import logging
import math
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.warp import Resampling, calculate_default_transform, reproject
from rasterio.windows import Window, from_bounds as window_from_bounds, intersection
from shapely.geometry import mapping, shape
from shapely.ops import transform as shp_transform

from src.service._shared.bbox import BBox
from src.service._shared.storage import (
    category_file,
    ensure_dir,
    read_json,
    write_category_meta,
)

logger = logging.getLogger(__name__)

# Grid resolution in metres (EPSG:3067 is planar metres in Finland).
_CELL_M = 50.0
# Road centerline buffer (each side) in metres.
_ROAD_BUFFER_M = 25.0
# Water-course buffer (each side) in metres — rivers/streams are rendered
# as linestrings or thin polygons; pad so they're at least one cell wide.
_WATER_COURSE_BUFFER_M = 15.0

# Slope cutoffs (degrees).
_SLOPE_AMBER_DEG = 10.0
_SLOPE_RED_DEG = 20.0

# Buffer around the requested bbox when sampling, so the 50 m grid extends
# slightly past the visible edge and slope gradients near the border don't
# go nan.
_FETCH_BUFFER_M = 200.0

# RGBA palette (R, G, B, A). Light blue = go; red = no-go; transparent = unsure.
_COLOR_NODATA = (0, 0, 0, 0)
_COLOR_UNSURE = (0, 0, 0, 0)                 # fully transparent middle ground
_COLOR_GO_OPEN = (140, 200, 240, 120)        # light blue, translucent
_COLOR_GO_ROAD = (110, 190, 240, 200)        # same hue, more opaque on roads
_COLOR_NOGO = (210, 55, 55, 215)             # red no-go

_to_3067 = Transformer.from_crs("EPSG:4326", "EPSG:3067", always_xy=True)
_project_to_3067 = _to_3067.transform


def _bbox_to_3067(bbox: BBox) -> tuple[float, float, float, float]:
    corners = [
        _to_3067.transform(bbox.min_lon, bbox.min_lat),
        _to_3067.transform(bbox.max_lon, bbox.min_lat),
        _to_3067.transform(bbox.max_lon, bbox.max_lat),
        _to_3067.transform(bbox.min_lon, bbox.max_lat),
    ]
    eastings = [c[0] for c in corners]
    northings = [c[1] for c in corners]
    return min(eastings), min(northings), max(eastings), max(northings)


def _load_features(path: Path) -> list[dict]:
    data = read_json(path)
    if not isinstance(data, dict):
        return []
    features = data.get("features") or []
    return [f for f in features if isinstance(f, dict) and f.get("geometry")]


def _build_slope_grid(
    tiff_path: Path,
    e_min: float,
    n_max: float,
    width: int,
    height: int,
) -> np.ndarray:
    """Resample the DEM tiff to a (height, width) grid in EPSG:3067 and
    return per-cell slope in degrees, with NaN where data is missing."""
    dst_transform = from_origin(e_min, n_max, _CELL_M, _CELL_M)
    dst = np.full((height, width), np.nan, dtype="float32")

    with rasterio.open(tiff_path) as ds:
        reproject(
            source=rasterio.band(ds, 1),
            destination=dst,
            src_transform=ds.transform,
            src_crs=ds.crs,
            src_nodata=ds.nodata,
            dst_transform=dst_transform,
            dst_crs="EPSG:3067",
            dst_nodata=np.nan,
            resampling=Resampling.average,
        )

    # Central-difference gradient in metres-per-metre.
    # Fill NaNs with the AoI mean before differentiating to avoid leaking
    # NaNs across cell neighbourhoods, then re-mask afterwards.
    if np.all(np.isnan(dst)):
        return dst
    filled = np.where(np.isnan(dst), float(np.nanmean(dst)), dst)
    dz_dy, dz_dx = np.gradient(filled, _CELL_M, _CELL_M)
    slope_rad = np.arctan(np.hypot(dz_dx, dz_dy))
    slope_deg = np.degrees(slope_rad).astype("float32")
    slope_deg[np.isnan(dst)] = np.nan
    return slope_deg


def _rasterize_features_3067(
    features: list[dict],
    e_min: float,
    n_max: float,
    width: int,
    height: int,
    *,
    line_buffer_m: float | None = None,
    polygon_buffer_m: float | None = None,
    value_fn=None,
) -> np.ndarray:
    """Rasterize 4326 geometries to a 3067 grid. If line_buffer_m is set,
    line geometries are buffered (in metres) before rasterisation.
    polygon_buffer_m optionally pads thin polygons (e.g. narrow rivers).
    value_fn(feature) → int (default 1)."""
    transform = from_origin(e_min, n_max, _CELL_M, _CELL_M)
    shapes: list[tuple[dict, int]] = []

    for feature in features:
        geom = feature.get("geometry")
        if not geom:
            continue
        try:
            geom_obj = shape(geom)
            geom_3067 = shp_transform(
                lambda x, y, z=None: _project_to_3067(x, y),
                geom_obj,
            )
        except Exception:
            continue
        if geom_3067.is_empty:
            continue
        gtype = geom_3067.geom_type
        if line_buffer_m is not None and gtype in ("LineString", "MultiLineString"):
            geom_3067 = geom_3067.buffer(line_buffer_m)
        elif polygon_buffer_m is not None and gtype in ("Polygon", "MultiPolygon"):
            geom_3067 = geom_3067.buffer(polygon_buffer_m)
        if geom_3067.is_empty:
            continue
        value = 1
        if value_fn is not None:
            try:
                value = int(value_fn(feature))
            except Exception:
                value = 1
        shapes.append((mapping(geom_3067), value))

    if not shapes:
        return np.zeros((height, width), dtype="uint8")
    return rasterize(
        shapes,
        out_shape=(height, width),
        transform=transform,
        fill=0,
        all_touched=True,
        dtype="uint8",
    )


def _road_class(feature: dict) -> int:
    """Map a tieviiva feature's length to a 1..3 road-tier (longer segments
    → higher tier, since major highways come back as longer linestrings).
    0 means no road."""
    try:
        length = int((feature.get("properties") or {}).get("length_m") or 0)
    except (TypeError, ValueError):
        length = 0
    if length >= 2000:
        return 3
    if length >= 500:
        return 2
    return 1


def _classify_to_rgba(
    slope_deg: np.ndarray,
    forest_mask: np.ndarray,
    water_mask: np.ndarray,
    road_tier: np.ndarray,
) -> np.ndarray:
    h, w = slope_deg.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)

    nodata = np.isnan(slope_deg)

    # Default = light-blue translucent go zone.
    rgba[..., 0] = _COLOR_GO_OPEN[0]
    rgba[..., 1] = _COLOR_GO_OPEN[1]
    rgba[..., 2] = _COLOR_GO_OPEN[2]
    rgba[..., 3] = _COLOR_GO_OPEN[3]

    # Unsure band (slope 10–20°) → fully transparent middle ground.
    unsure_mask = (~nodata) & (slope_deg >= _SLOPE_AMBER_DEG) & (slope_deg < _SLOPE_RED_DEG)
    rgba[unsure_mask] = _COLOR_UNSURE

    # No-go: steep, forested, or wet.
    nogo_mask = (~nodata) & (
        (slope_deg >= _SLOPE_RED_DEG) | (forest_mask > 0) | (water_mask > 0)
    )
    rgba[nogo_mask] = _COLOR_NOGO

    # Roads override everything: still go, but emphasised. Don't repaint
    # cells whose road is over open water — water wins there.
    road_low_mask = ((road_tier == 1) | (road_tier == 2)) & (water_mask == 0)
    road_high_mask = (road_tier >= 3) & (water_mask == 0)
    rgba[road_low_mask] = _COLOR_GO_OPEN
    rgba[road_high_mask] = _COLOR_GO_ROAD

    rgba[nodata] = _COLOR_NODATA
    return rgba


def _reproject_rgba_to_4326(
    rgba_3067: np.ndarray,
    e_min: float,
    n_max: float,
    bbox: BBox,
) -> np.ndarray:
    """Reproject the 3067 RGBA grid to 4326 and crop to bbox. Each channel
    is reprojected separately using nearest-neighbour to preserve the
    discrete class colours."""
    h, w, _ = rgba_3067.shape
    src_transform = from_origin(e_min, n_max, _CELL_M, _CELL_M)
    src_bounds = (e_min, n_max - h * _CELL_M, e_min + w * _CELL_M, n_max)

    dst_transform, dst_w, dst_h = calculate_default_transform(
        "EPSG:3067", "EPSG:4326", w, h, *src_bounds,
    )

    dst = np.zeros((dst_h, dst_w, 4), dtype=np.uint8)
    for band_idx in range(4):
        reproject(
            source=rgba_3067[..., band_idx],
            destination=dst[..., band_idx],
            src_transform=src_transform,
            src_crs="EPSG:3067",
            src_nodata=0,
            dst_transform=dst_transform,
            dst_crs="EPSG:4326",
            dst_nodata=0,
            resampling=Resampling.nearest,
        )

    crop_window = window_from_bounds(
        bbox.min_lon, bbox.min_lat, bbox.max_lon, bbox.max_lat, dst_transform,
    ).round_offsets().round_lengths()
    crop_window = intersection(crop_window, Window(0, 0, dst_w, dst_h))

    row_start = int(crop_window.row_off)
    col_start = int(crop_window.col_off)
    row_stop = row_start + int(crop_window.height)
    col_stop = col_start + int(crop_window.width)
    return dst[row_start:row_stop, col_start:col_stop]


def _empty_png(out_path: Path) -> tuple[int, int]:
    image = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    ensure_dir(out_path.parent)
    image.save(out_path)
    return image.size


def build_movement_corridors_heavy(aoi_id: str, bbox: BBox) -> dict:
    """Compute the heavy-vehicle movement-corridors PNG for the AoI.

    Returns a summary dict. The PNG is written to
    {aoi_id}/derived/movement_corridors_heavy.png.
    """
    out_path = category_file(aoi_id, "derived", "movement_corridors_heavy.png")
    ensure_dir(out_path.parent)

    dem_tiff = category_file(aoi_id, "dem", "elevation.tif")
    forest_path = category_file(aoi_id, "land", "forest.geojson")
    roads_path = category_file(aoi_id, "infrastructure", "roads.geojson")
    water_bodies_path = category_file(aoi_id, "water", "bodies.geojson")
    water_courses_path = category_file(aoi_id, "water", "courses.geojson")

    if not dem_tiff.exists():
        logger.warning("movement_corridors: DEM tiff missing (%s)", dem_tiff)
        _empty_png(out_path)
        write_category_meta(
            aoi_id, "derived",
            source="Derived movement corridors (heavy vehicles)",
            confidence="low",
            feature_counts={"missing_dem": 1},
        )
        return {"status": "missing_dem"}

    # Build a 3067 grid covering the bbox, with a small buffer.
    e_min, n_min, e_max, n_max = _bbox_to_3067(bbox)
    e_min -= _FETCH_BUFFER_M
    n_min -= _FETCH_BUFFER_M
    e_max += _FETCH_BUFFER_M
    n_max += _FETCH_BUFFER_M

    width = max(1, int(math.ceil((e_max - e_min) / _CELL_M)))
    height = max(1, int(math.ceil((n_max - n_min) / _CELL_M)))
    logger.info(
        "movement_corridors: 3067 grid %dx%d (%.0fm cells, %.1fkm x %.1fkm)",
        width, height, _CELL_M,
        (e_max - e_min) / 1000.0, (n_max - n_min) / 1000.0,
    )

    slope_deg = _build_slope_grid(dem_tiff, e_min, n_max, width, height)

    # Forest: use the pre-filtered subset written by land.py. Treat ANY
    # forest polygon as no-go for heavy vehicles — NLS doesn't reliably
    # tag canopy density per polygon, and operator expectation here is
    # "trees stop tanks" rather than "we need closed-canopy proof".
    forest_features = _load_features(forest_path)
    forest_mask = _rasterize_features_3067(
        forest_features, e_min, n_max, width, height,
    )

    # Water: bodies (lakes) as-is; courses (rivers/streams) buffered so
    # narrow linestrings still take out at least one full grid cell.
    water_features = (
        _load_features(water_bodies_path)
        + _load_features(water_courses_path)
    )
    water_mask = _rasterize_features_3067(
        water_features, e_min, n_max, width, height,
        line_buffer_m=_WATER_COURSE_BUFFER_M,
        polygon_buffer_m=0.0,
    )

    road_features = _load_features(roads_path)
    road_tier = _rasterize_features_3067(
        road_features, e_min, n_max, width, height,
        line_buffer_m=_ROAD_BUFFER_M,
        value_fn=_road_class,
    )

    rgba_3067 = _classify_to_rgba(slope_deg, forest_mask, water_mask, road_tier)
    rgba_4326 = _reproject_rgba_to_4326(rgba_3067, e_min, n_max, bbox)

    image = Image.fromarray(rgba_4326, mode="RGBA")
    image.save(out_path)

    valid = int(np.isfinite(slope_deg).sum())
    nogo = int(
        (
            (slope_deg >= _SLOPE_RED_DEG)
            | (forest_mask > 0)
            | (water_mask > 0)
        ).sum()
    )
    unsure = int(
        (
            (slope_deg >= _SLOPE_AMBER_DEG) & (slope_deg < _SLOPE_RED_DEG)
        ).sum()
    )
    road_cells = int((road_tier > 0).sum())
    forest_cells = int((forest_mask > 0).sum())
    water_cells = int((water_mask > 0).sum())

    counts = {
        "cells_total": int(width * height),
        "cells_valid": valid,
        "cells_nogo": nogo,
        "cells_unsure": unsure,
        "cells_forest": forest_cells,
        "cells_water": water_cells,
        "cells_road": road_cells,
        "image_pixels": int(rgba_4326.shape[0] * rgba_4326.shape[1]),
    }
    write_category_meta(
        aoi_id, "derived",
        source="Derived movement corridors (heavy vehicles)",
        confidence="high",
        feature_counts=counts,
    )
    logger.info("movement_corridors: %s", counts)
    return {"source": "Derived movement corridors (heavy vehicles)", "counts": counts}
