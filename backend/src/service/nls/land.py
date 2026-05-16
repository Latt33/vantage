"""Land cover features from the National Land Survey of Finland (NLS).

Fetches land cover (forest, buildings) from the NLS OGC Features API.

Output files:
    {aoi_id}/land/cover.geojson      — NLS 'metsamaankasvillisuus' collection
    {aoi_id}/land/cover.png          — rasterized land-use overlay
    {aoi_id}/land/forest.geojson     — forest-only subset derived from cover.geojson
    {aoi_id}/land/forest.png         — rasterized forest-density overlay
    {aoi_id}/land/buildings.geojson  — NLS 'rakennus' collection
    {aoi_id}/land/meta.json
"""

import logging
import os

import httpx
import numpy as np
from PIL import Image
from rasterio.features import rasterize
from rasterio.transform import from_bounds

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.geojson import feature_collection
from src.service._shared.storage import (
    category_file,
    write_category_meta,
    write_json,
)

logger = logging.getLogger(__name__)

_NLS_BASE = "https://avoin-paikkatieto.maanmittauslaitos.fi/maastotiedot/features/v1"
MML_API_KEY = os.getenv("MML_API_KEY", "")
_LIMIT = 1000

_COLLECTIONS = [
    ("metsamaankasvillisuus", "cover.geojson", "Land cover"),
    ("rakennus",              "buildings.geojson", "Buildings"),
]

_LAND_CLASSES: dict[str, tuple[str, tuple[int, int, int]]] = {
    "forest": ("Forest", (42, 122, 42)),
    "built": ("Built-up", (139, 90, 43)),
    "water": ("Water", (42, 109, 181)),
    "wetland": ("Wetland", (79, 127, 91)),
    "open": ("Open land", (168, 184, 95)),
    "rock": ("Rock", (122, 122, 122)),
    "other": ("Other", (90, 122, 90)),
}


def _classify_land(text: str) -> tuple[str, str]:
    if any(token in text for token in ("forest", "wood", "mets", "metsa")):
        return "forest", _LAND_CLASSES["forest"][0]
    if any(token in text for token in ("building", "rakenn", "house", "built", "asuin", "teoll")):
        return "built", _LAND_CLASSES["built"][0]
    if any(token in text for token in ("water", "lake", "river", "vesi", "järvi", "jarvi")):
        return "water", _LAND_CLASSES["water"][0]
    if any(token in text for token in ("swamp", "wetland", "suo", "bog", "marsh")):
        return "wetland", _LAND_CLASSES["wetland"][0]
    if any(token in text for token in ("field", "grass", "meadow", "pelto", "niitty", "open")):
        return "open", _LAND_CLASSES["open"][0]
    if any(token in text for token in ("rock", "kallio", "bedrock")):
        return "rock", _LAND_CLASSES["rock"][0]
    return "other", _LAND_CLASSES["other"][0]


def _annotate_features(features: list[dict], collection_id: str, label: str) -> list[dict]:
    annotated: list[dict] = []
    for feature in features:
        props = feature.setdefault("properties", {})
        props["nls_collection"] = collection_id
        props["nls_label"] = label
        text = " ".join(str(v).lower() for v in props.values())
        land_class, land_label = _classify_land(text)
        props["land_class"] = land_class
        props["land_label"] = land_label
        annotated.append(feature)
    return annotated


def _forest_features(features: list[dict]) -> list[dict]:
    forest: list[dict] = []
    for feature in features:
        props = feature.get("properties") or {}
        if str(props.get("land_class") or "").lower() == "forest":
            forest.append(feature)
    return forest


def _geometry_to_shapes(features: list[dict]) -> list[tuple[dict, int]]:
    class_ids = {name: i + 1 for i, name in enumerate(_LAND_CLASSES.keys())}
    shapes: list[tuple[dict, int]] = []
    for feature in features:
        geom = feature.get("geometry")
        props = feature.get("properties") or {}
        land_class = str(props.get("land_class") or "other")
        value = class_ids.get(land_class, class_ids["other"])
        if geom and geom.get("type") in {"Polygon", "MultiPolygon"}:
            shapes.append((geom, value))
    return shapes


def _land_png_size(bbox: BBox, max_side: int = 2048) -> tuple[int, int]:
    lon_span = max(abs(bbox.max_lon - bbox.min_lon), 1e-9)
    lat_span = max(abs(bbox.max_lat - bbox.min_lat), 1e-9)
    aspect = lon_span / lat_span
    if aspect >= 1:
        width = max_side
        height = max(512, int(round(max_side / aspect)))
    else:
        height = max_side
        width = max(512, int(round(max_side * aspect)))
    return width, height


def _write_land_png(features: list[dict], bbox: BBox, out_path) -> tuple[int, int]:
    width, height = _land_png_size(bbox)
    transform = from_bounds(bbox.min_lon, bbox.min_lat, bbox.max_lon, bbox.max_lat, width, height)

    class_ids = {name: i + 1 for i, name in enumerate(_LAND_CLASSES.keys())}
    raster = rasterize(
        _geometry_to_shapes(features),
        out_shape=(height, width),
        transform=transform,
        fill=0,
        all_touched=True,
        dtype=np.uint8,
    )

    rgba = np.zeros((height, width, 4), dtype=np.uint8)
    for land_class, (_, color) in _LAND_CLASSES.items():
        mask = raster == class_ids[land_class]
        if not mask.any():
            continue
        rgba[mask, 0] = color[0]
        rgba[mask, 1] = color[1]
        rgba[mask, 2] = color[2]
        rgba[mask, 3] = 220

    image = Image.fromarray(rgba, mode="RGBA")
    image.save(out_path)
    return image.size


def _write_empty_png(out_path) -> tuple[int, int]:
    image = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    image.save(out_path)
    return image.size


async def _fetch_collection(collection_id: str, bbox: BBox) -> list[dict]:
    url = f"{_NLS_BASE}/collections/{collection_id}/items"
    params = {"bbox": str(bbox), "limit": _LIMIT, "f": "json"}
    try:
        auth = (MML_API_KEY, "") if MML_API_KEY else None
        resp = await client.get(url, params=params, auth=auth)
        resp.raise_for_status()
        return resp.json().get("features", [])
    except Exception as exc:
        logger.warning("NLS collection '%s' error: %s", collection_id, exc)
        return []


async def fetch_land(aoi_id: str, bbox: BBox) -> dict:
    """Fetch land cover features and write to disk."""
    feature_counts: dict[str, int] = {}
    cover_features: list[dict] = []

    for collection_id, filename, label in _COLLECTIONS:
        features = await _fetch_collection(collection_id, bbox)
        features = _annotate_features(features, collection_id, label)
        fc = feature_collection(features, source="NLS Finland — Topographic Database")
        write_json(category_file(aoi_id, "land", filename), fc)
        feature_counts[filename] = len(features)
        logger.info("NLS land: %d features → %s", len(features), filename)
        if filename == "cover.geojson":
            cover_features = features

    forest_features = _forest_features(cover_features)

    forest_geojson_path = category_file(aoi_id, "land", "forest.geojson")
    write_json(forest_geojson_path, feature_collection(forest_features, source="NLS Finland — Topographic Database"))
    feature_counts["forest.geojson"] = len(forest_features)

    image_path = category_file(aoi_id, "land", "cover.png")
    if cover_features:
        image_size = _write_land_png(cover_features, bbox, image_path)
        feature_counts["cover.png"] = image_size[0] * image_size[1]
    else:
        _write_empty_png(image_path)
        feature_counts["cover.png"] = 0

    forest_image_path = category_file(aoi_id, "land", "forest.png")
    if forest_features:
        image_size = _write_land_png(forest_features, bbox, forest_image_path)
        feature_counts["forest.png"] = image_size[0] * image_size[1]
    else:
        _write_empty_png(forest_image_path)
        feature_counts["forest.png"] = 0

    geojson_counts = [count for name, count in feature_counts.items() if name.endswith(".geojson")]
    write_category_meta(
        aoi_id, "land",
        source="NLS Finland — Topographic Database",
        confidence="high" if any(n > 0 for n in geojson_counts) else "low",
        feature_counts=feature_counts,
    )
    return {"source": "NLS Finland", "feature_counts": feature_counts}
