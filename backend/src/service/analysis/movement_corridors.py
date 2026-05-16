"""Movement corridors for heavy vehicles.

Combines three cached datasets to produce a single trafficability raster:
  - DEM (NLS korkeusmalli_2m, EPSG:3067) → slope per cell
  - Forest cover (NLS metsamaankasvillisuus, vector polygons) → dense-forest mask
  - Roads (NLS tieviiva, vector lines) → road mask (boosts mobility)

The grid is built in EPSG:3067 at 50 m resolution, classified per cell, then
reprojected to EPSG:4326 and cropped to the AoI bbox for map rendering.

Classification rules (heavy tracked vehicles, ~60 t MBT/IFV):
  - road within 25 m              → GREEN (high mobility, tiered by road class)
  - slope ≥ 20° OR dense forest   → RED   (no-go)
  - 10° ≤ slope < 20°             → AMBER (restricted)
  - otherwise                     → GREEN-DIM (open, trafficable)

This service does not call external APIs. It reads cached datasets and
writes a single derived PNG + meta for the AoI.

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

# Slope cutoffs (degrees).
_SLOPE_AMBER_DEG = 10.0
_SLOPE_RED_DEG = 20.0

# Buffer around the requested bbox when sampling DEM/forest/roads, so the
# 50 m grid extends slightly past the visible edge and slope gradients near
# the border don't go nan.
_FETCH_BUFFER_M = 200.0

# Forest classification keywords — mirrors analysis/mcoo.py so the two
# derivatives stay consistent.
_FOREST_KEYWORDS = (
    "forest", "wood", "woodland", "conifer", "deciduous", "mixed",
    "mets", "metsa",
)
_DENSE_KEYWORDS = (
    "dense", "thick", "closed", "tihea",
)

# RGBA palette (R, G, B, A).
_COLOR_NODATA = (0, 0, 0, 0)
_COLOR_OPEN = (60, 140, 60, 130)     # passable open ground
_COLOR_AMBER = (210, 150, 40, 180)    # restricted (slope 10–20°)
_COLOR_RED = (200, 50, 50, 210)       # no-go (slope ≥ 20° or dense forest)
_COLOR_ROAD_LOW = (120, 220, 140, 220)
_COLOR_ROAD_HIGH = (40, 200, 110, 235)

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


def _props_text(props: dict | None) -> str:
    if not props:
        return ""
    return " ".join(str(v).lower() for v in props.values() if v is not None)


def _is_dense_forest(props: dict) -> bool:
    text = _props_text(props)
    if not any(k in text for k in _FOREST_KEYWORDS):
        return False
    # If the polygon is tagged as forest, treat it as dense-enough for
    # heavy-vehicle no-go unless we can prove otherwise. NLS rarely tags
    # canopy density per-polygon, so falling back to "any forest = dense"
    # matches operator expectations better than mostly-empty output.
    if any(k in text for k in _DENSE_KEYWORDS):
        return True
    return any(k in text for k in ("forest", "metsa", "mets", "wood"))


def _build_slope_grid(
    tiff_path: Path,
    e_min: float,
    n_min: float,
    e_max: float,
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
    # np.gradient: axis 0 = rows (northing, north→south), axis 1 = cols (easting, west→east).
    # Replace nans with cell-neighbourhood mean before gradient to avoid nan propagation.
    filled = np.where(np.isnan(dst), np.nanmean(dst), dst)
    dz_dy, dz_dx = np.gradient(filled, _CELL_M, _CELL_M)
    slope_rad = np.arctan(np.hypot(dz_dx, dz_dy))
    slope_deg = np.degrees(slope_rad).astype("float32")
    # Re-mask cells that were originally nodata (gradient can leak across the edge).
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
    value_fn=None,
) -> np.ndarray:
    """Rasterize 4326 geometries to a 3067 grid. If line_buffer_m is set,
    line geometries are buffered (in 3067 metres) before rasterisation.
    value_fn(props) → int (default 1)."""
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
        if line_buffer_m is not None and geom_3067.geom_type in ("LineString", "MultiLineString"):
            geom_3067 = geom_3067.buffer(line_buffer_m)
            if geom_3067.is_empty:
                continue
        value = 1
        if value_fn is not None:
            try:
                value = int(value_fn(feature.get("properties") or {}))
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


def _road_class(props: dict) -> int:
    """Map a tieviiva feature's length to a 1..3 road-tier value (longer
    segments → higher tier, since major highways come back as longer
    linestrings). 0 means no road."""
    length = 0
    try:
        length = int(props.get("length_m") or 0)
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
    road_tier: np.ndarray,
) -> np.ndarray:
    h, w = slope_deg.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)

    nodata = np.isnan(slope_deg)

    # Base case: open ground.
    rgba[..., 0] = _COLOR_OPEN[0]
    rgba[..., 1] = _COLOR_OPEN[1]
    rgba[..., 2] = _COLOR_OPEN[2]
    rgba[..., 3] = _COLOR_OPEN[3]

    # Amber band.
    amber_mask = (~nodata) & (slope_deg >= _SLOPE_AMBER_DEG) & (slope_deg < _SLOPE_RED_DEG)
    rgba[amber_mask] = _COLOR_AMBER

    # Red: severe slope OR dense forest.
    red_mask = (~nodata) & ((slope_deg >= _SLOPE_RED_DEG) | (forest_mask > 0))
    rgba[red_mask] = _COLOR_RED

    # Roads override everything (you can drive through forest on a road).
    road_low_mask = (road_tier == 1) | (road_tier == 2)
    road_high_mask = road_tier >= 3
    rgba[road_low_mask] = _COLOR_ROAD_LOW
    rgba[road_high_mask] = _COLOR_ROAD_HIGH

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
    land_cover = category_file(aoi_id, "land", "cover.geojson")
    roads_path = category_file(aoi_id, "infrastructure", "roads.geojson")

    missing = [p.name for p in (dem_tiff, land_cover, roads_path) if not p.exists()]
    if missing:
        logger.warning("movement_corridors: missing inputs %s", missing)
        _empty_png(out_path)
        write_category_meta(
            aoi_id, "derived",
            source="Derived movement corridors (heavy vehicles)",
            confidence="low",
            feature_counts={"missing_inputs": len(missing)},
        )
        return {"status": "missing_inputs", "missing": missing}

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

    slope_deg = _build_slope_grid(dem_tiff, e_min, n_min, e_max, n_max, width, height)

    cover = read_json(land_cover) or {}
    cover_features = cover.get("features", []) if isinstance(cover, dict) else []
    dense_forest = [f for f in cover_features if _is_dense_forest(f.get("properties") or {})]
    forest_mask = _rasterize_features_3067(
        dense_forest, e_min, n_max, width, height,
    )

    roads = read_json(roads_path) or {}
    road_features = roads.get("features", []) if isinstance(roads, dict) else []
    road_tier = _rasterize_features_3067(
        road_features,
        e_min, n_max, width, height,
        line_buffer_m=_ROAD_BUFFER_M,
        value_fn=_road_class,
    )

    rgba_3067 = _classify_to_rgba(slope_deg, forest_mask, road_tier)
    rgba_4326 = _reproject_rgba_to_4326(rgba_3067, e_min, n_max, bbox)

    image = Image.fromarray(rgba_4326, mode="RGBA")
    image.save(out_path)

    valid = np.isfinite(slope_deg).sum()
    red = int(((slope_deg >= _SLOPE_RED_DEG) | (forest_mask > 0)).sum())
    amber = int(((slope_deg >= _SLOPE_AMBER_DEG) & (slope_deg < _SLOPE_RED_DEG)).sum())
    road_cells = int((road_tier > 0).sum())

    counts = {
        "cells_total": int(width * height),
        "cells_valid": int(valid),
        "cells_red": red,
        "cells_amber": amber,
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
