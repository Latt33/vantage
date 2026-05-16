"""Automated Modified Combined Obstacle Overlay (MCOO).

Derives trafficability zones by intersecting existing layers:
- DEM slope vectors (optional) at terrain/slope.geojson or dem/slope.geojson
- NLS land cover at land/cover.geojson
- NLS watercourses at water/courses.geojson

This service does not call external APIs. It reads cached datasets and
writes a single derived layer for the AoI.
"""

from __future__ import annotations

import logging
import math
from pathlib import Path

from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union

from src.service._shared.bbox import BBox
from src.service._shared.geojson import feature_collection
from src.service._shared.storage import (
    category_file,
    read_json,
    write_category_meta,
    write_json,
)

logger = logging.getLogger(__name__)

_SLOPE_INPUT_CANDIDATES = [
    ("terrain", "slope.geojson"),
    ("dem", "slope.geojson"),
]

_WATER_BUFFER_METERS = 30.0

_FOREST_KEYWORDS = [
    "forest",
    "wood",
    "woodland",
    "conifer",
    "deciduous",
    "mixed",
    "metsa",
]

_MARSH_KEYWORDS = [
    "marsh",
    "swamp",
    "bog",
    "wetland",
    "mire",
    "fen",
    "peat",
    "suo",
    "neva",
]

_DENSE_KEYWORDS = [
    "dense",
    "thick",
    "closed",
    "tihea",
]


def _load_features(path: Path) -> list[dict]:
    data = read_json(path)
    if not isinstance(data, dict) or data.get("type") != "FeatureCollection":
        return []
    features = data.get("features", [])
    return [f for f in features if isinstance(f, dict) and f.get("geometry")]


def _props_text(props: dict) -> str:
    parts: list[str] = []
    for value in props.values():
        if value is None:
            continue
        parts.append(str(value).lower())
    return " ".join(parts)


def _matches_any(text: str, keywords: list[str]) -> bool:
    return any(k in text for k in keywords)


def _is_dense_forest(props: dict) -> bool:
    text = _props_text(props)
    return _matches_any(text, _FOREST_KEYWORDS) and (
        _matches_any(text, _DENSE_KEYWORDS) or "forest" in text or "metsa" in text
    )


def _is_marsh(props: dict) -> bool:
    return _matches_any(_props_text(props), _MARSH_KEYWORDS)


def _extract_slope_deg(props: dict) -> float | None:
    if not props:
        return None
    for key in (
        "slope_deg",
        "slope_degrees",
        "slope",
        "mean_slope",
        "slope_mean",
        "slope_avg",
    ):
        if key in props:
            try:
                return float(props[key])
            except (TypeError, ValueError):
                return None
    return None


def _safe_shape(geom: dict):
    try:
        return shape(geom)
    except Exception:
        return None


def _water_buffer_degrees(bbox: BBox) -> float:
    lat_mid = (bbox.min_lat + bbox.max_lat) / 2.0
    lat_m = 111_000.0
    lon_m = lat_m * max(math.cos(math.radians(lat_mid)), 0.1)
    buffer_lat = _WATER_BUFFER_METERS / lat_m
    buffer_lon = _WATER_BUFFER_METERS / lon_m
    return max(buffer_lat, buffer_lon)


def _build_zone_feature(zone_geom, zone_class: str, label: str, sources: list[str]) -> dict:
    return {
        "type": "Feature",
        "geometry": mapping(zone_geom),
        "properties": {
            "class": zone_class,
            "label": label,
            "sources": sources,
        },
    }


async def build_mcoo(aoi_id: str, bbox: BBox) -> dict:
    """Build MCOO trafficability zones from cached datasets."""
    land_path = category_file(aoi_id, "land", "cover.geojson")
    water_path = category_file(aoi_id, "water", "courses.geojson")

    slope_path = None
    for category, filename in _SLOPE_INPUT_CANDIDATES:
        candidate = category_file(aoi_id, category, filename)
        if candidate.exists():
            slope_path = candidate
            break

    land_features = _load_features(land_path)
    water_features = _load_features(water_path)
    slope_features: list[dict] = []
    if slope_path is not None:
        slope_features = _load_features(slope_path)

    inputs_used: list[str] = []
    if land_features:
        inputs_used.append("land/cover.geojson")
    if water_features:
        inputs_used.append("water/courses.geojson")
    if slope_features and slope_path is not None:
        inputs_used.append(str(slope_path.parent.name) + "/" + slope_path.name)

    severe_parts = []
    restricted_parts = []

    for feature in land_features:
        props = feature.get("properties", {}) or {}
        geom = _safe_shape(feature.get("geometry", {}))
        if geom is None or geom.is_empty:
            continue
        if _is_marsh(props):
            severe_parts.append(geom)
        elif _is_dense_forest(props):
            restricted_parts.append(geom)

    buffer_deg = _water_buffer_degrees(bbox)
    for feature in water_features:
        geom = _safe_shape(feature.get("geometry", {}))
        if geom is None or geom.is_empty:
            continue
        severe_parts.append(geom.buffer(buffer_deg))

    for feature in slope_features:
        props = feature.get("properties", {}) or {}
        slope_deg = _extract_slope_deg(props)
        if slope_deg is None:
            continue
        geom = _safe_shape(feature.get("geometry", {}))
        if geom is None or geom.is_empty:
            continue
        if slope_deg >= 30.0:
            severe_parts.append(geom)
        elif slope_deg >= 15.0:
            restricted_parts.append(geom)

    severe_geom = unary_union(severe_parts) if severe_parts else None
    restricted_geom = unary_union(restricted_parts) if restricted_parts else None

    if severe_geom and restricted_geom:
        restricted_geom = restricted_geom.difference(severe_geom)

    combined_geom = None
    if severe_geom and restricted_geom:
        combined_geom = severe_geom.union(restricted_geom)
    elif severe_geom:
        combined_geom = severe_geom
    elif restricted_geom:
        combined_geom = restricted_geom

    bbox_geom = box(bbox.min_lon, bbox.min_lat, bbox.max_lon, bbox.max_lat)
    unrestricted_geom = bbox_geom if combined_geom is None else bbox_geom.difference(combined_geom)

    features: list[dict] = []
    if severe_geom and not severe_geom.is_empty:
        features.append(_build_zone_feature(
            severe_geom,
            "severely_restricted",
            "Severely Restricted",
            inputs_used,
        ))
    if restricted_geom and not restricted_geom.is_empty:
        features.append(_build_zone_feature(
            restricted_geom,
            "restricted",
            "Restricted",
            inputs_used,
        ))
    if unrestricted_geom and not unrestricted_geom.is_empty:
        features.append(_build_zone_feature(
            unrestricted_geom,
            "unrestricted",
            "Unrestricted",
            inputs_used,
        ))

    output = feature_collection(features, source="Derived MCOO")
    write_json(category_file(aoi_id, "mcoo", "trafficability.geojson"), output)

    counts = {"trafficability.geojson": len(features)}
    confidence = "high" if inputs_used else "low"
    write_category_meta(
        aoi_id,
        "mcoo",
        source="Derived from cached NLS + DEM inputs",
        confidence=confidence,
        feature_counts=counts,
    )

    logger.info("MCOO: %d zones built from %s", len(features), ", ".join(inputs_used) or "no inputs")
    return {
        "source": "Derived from cached NLS + DEM inputs",
        "feature_counts": counts,
        "inputs_used": inputs_used,
    }
