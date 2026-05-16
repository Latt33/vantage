"""Land cover features from the National Land Survey of Finland (NLS).

Fetches polygon land cover features from the NLS OGC Features API and
rasterizes them to PNG overlays for fast map rendering.

NLS API has no explicit polygon forest layer at map scale. Forest polygons
are sourced from OpenStreetMap (natural=wood, landuse=forest) via Overpass.

Output files:
    {aoi_id}/land/cover.geojson      — combined polygon land cover features
    {aoi_id}/land/cover.png          — rasterized land-use overlay
    {aoi_id}/land/forest.geojson     — OSM forest polygons
    {aoi_id}/land/forest.png         — forest density raster (yellow → dark green)
    {aoi_id}/land/buildings.geojson  — NLS 'rakennus' collection
    {aoi_id}/land/meta.json
"""

import logging
import math
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

_OVERPASS_URL = "https://overpass-api.de/api/interpreter"
_OVERPASS_TIMEOUT = httpx.Timeout(connect=30.0, read=90.0, write=10.0, pool=5.0)

# Forest density palette: yellow (sparse/small) → dark green (dense/large)
_FOREST_DENSITY_COLORS: list[tuple[int, int, int]] = [
    (200, 190,  40),
    (160, 185,  35),
    (100, 160,  35),
    ( 60, 130,  30),
    ( 30,  95,  20),
    ( 15,  60,  10),
]

# Polygon collections for land cover — all confirmed to return Polygon geometry.
# (collection_id, label)
_LAND_COLLECTIONS: list[tuple[str, str]] = [
    ("taajaanrakennettualue", "Built-up area"),
    ("maatalousmaa",          "Agricultural land"),
    ("suo",                   "Bog/Swamp"),
    ("muuavoinalue",          "Other open area"),
    ("niitty",                "Meadow"),
    ("kallioalue",            "Rock area"),
    ("hietikko",              "Sandy area"),
]

# Direct collection → land class mapping (avoids fragile text matching).
_COLLECTION_CLASS: dict[str, str] = {
    "taajaanrakennettualue": "built",
    "maatalousmaa":          "open",
    "suo":                   "wetland",
    "muuavoinalue":          "open",
    "niitty":                "open",
    "kallioalue":            "rock",
    "hietikko":              "open",
    "rakennus":              "built",
}

_LAND_CLASSES: dict[str, tuple[str, tuple[int, int, int]]] = {
    "forest":  ("Forest",    (42,  122,  42)),
    "built":   ("Built-up",  (139,  90,  43)),
    "water":   ("Water",     (42,  109, 181)),
    "wetland": ("Wetland",   (79,  127,  91)),
    "open":    ("Open land", (168, 184,  95)),
    "rock":    ("Rock",      (122, 122, 122)),
    "other":   ("Other",     (90,  122,  90)),
}


def _classify_land(text: str) -> tuple[str, str]:
    if any(t in text for t in ("forest", "wood", "mets", "metsa")):
        return "forest", _LAND_CLASSES["forest"][0]
    if any(t in text for t in ("building", "rakenn", "house", "built", "asuin", "teoll")):
        return "built", _LAND_CLASSES["built"][0]
    if any(t in text for t in ("water", "lake", "river", "vesi", "järvi", "jarvi")):
        return "water", _LAND_CLASSES["water"][0]
    if any(t in text for t in ("swamp", "wetland", "suo", "bog", "marsh")):
        return "wetland", _LAND_CLASSES["wetland"][0]
    if any(t in text for t in ("field", "grass", "meadow", "pelto", "niitty", "open", "agri", "maatalous")):
        return "open", _LAND_CLASSES["open"][0]
    if any(t in text for t in ("rock", "kallio", "bedrock", "sandy", "hietikko")):
        return "rock", _LAND_CLASSES["rock"][0]
    return "other", _LAND_CLASSES["other"][0]


def _annotate_features(features: list[dict], collection_id: str, label: str) -> list[dict]:
    annotated: list[dict] = []
    for feature in features:
        props = feature.setdefault("properties", {})
        props["nls_collection"] = collection_id
        props["nls_label"] = label
        # Use direct mapping first; fall back to text matching for unknown collections.
        if collection_id in _COLLECTION_CLASS:
            land_class = _COLLECTION_CLASS[collection_id]
            land_label = _LAND_CLASSES[land_class][0]
        else:
            text = " ".join(str(v).lower() for v in props.values())
            land_class, land_label = _classify_land(text)
        props["land_class"] = land_class
        props["land_label"] = land_label
        annotated.append(feature)
    return annotated


def _forest_features(features: list[dict]) -> list[dict]:
    return [
        f for f in features
        if str((f.get("properties") or {}).get("land_class") or "").lower() == "forest"
    ]


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
    shapes = _geometry_to_shapes(features)

    # Forest is the implied residual: every pixel without an explicit class is forest.
    # Start the raster with the forest class id so unclassified land is forest-colored.
    forest_fill = class_ids["forest"]

    if not shapes:
        # No explicit polygons at all — paint the whole tile forest green.
        raster = np.full((height, width), forest_fill, dtype=np.uint8)
    else:
        raster = rasterize(
            shapes,
            out_shape=(height, width),
            transform=transform,
            fill=forest_fill,
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


def _polygon_area_deg2(geom: dict) -> float:
    """Shoelace area of the outer ring in degrees² (used as a density proxy)."""
    try:
        coords = geom["coordinates"][0]
        n = len(coords)
        area = 0.0
        for i in range(n - 1):
            area += coords[i][0] * coords[i + 1][1]
            area -= coords[i + 1][0] * coords[i][1]
        return abs(area) / 2.0
    except Exception:
        return 0.0


def _write_forest_density_png(features: list[dict], bbox: BBox, out_path) -> tuple[int, int]:
    """Rasterize forest polygons, coloring yellow→dark-green by log(area).

    Non-forest pixels get the lightest yellow at reduced opacity so the whole
    AOI is covered and the canopy gradient reads across the full extent.
    """
    width, height = _land_png_size(bbox)
    transform = from_bounds(bbox.min_lon, bbox.min_lat, bbox.max_lon, bbox.max_lat, width, height)

    n_classes = len(_FOREST_DENSITY_COLORS)

    # Palette class 0 = no-forest background; classes 1..n = forest density.
    # Reserve value 0 for non-forest so rasterize fill=0 marks unclassified pixels.
    shapes: list[tuple[dict, int]] = []
    if features:
        areas = [_polygon_area_deg2(f["geometry"]) for f in features if f.get("geometry")]
        log_areas = [math.log(max(a, 1e-12)) for a in areas]
        lo = min(log_areas) if log_areas else 0.0
        hi = max(log_areas) if log_areas else 1.0
        rng = hi - lo if hi > lo else 1.0

        feat_iter = (f for f in features if f.get("geometry") and f["geometry"].get("type") in {"Polygon", "MultiPolygon"})
        for feat, la in zip(feat_iter, log_areas):
            cls = max(1, min(n_classes, int(1 + (n_classes - 1) * (la - lo) / rng)))
            shapes.append((feat["geometry"], cls))

    if shapes:
        raster = rasterize(
            shapes,
            out_shape=(height, width),
            transform=transform,
            fill=0,
            all_touched=True,
            dtype=np.uint8,
        )
    else:
        raster = np.zeros((height, width), dtype=np.uint8)

    palette = np.asarray(_FOREST_DENSITY_COLORS, dtype=np.uint8)
    rgba = np.zeros((height, width, 4), dtype=np.uint8)

    # Non-forest: lightest yellow at reduced opacity to show "no canopy here"
    no_forest = raster == 0
    rgba[no_forest, 0] = palette[0, 0]
    rgba[no_forest, 1] = palette[0, 1]
    rgba[no_forest, 2] = palette[0, 2]
    rgba[no_forest, 3] = 90

    # Forest pixels: full opacity, color by density class
    for i, color in enumerate(palette):
        mask = raster == (i + 1)
        if not mask.any():
            continue
        rgba[mask, 0] = color[0]
        rgba[mask, 1] = color[1]
        rgba[mask, 2] = color[2]
        rgba[mask, 3] = 210

    image = Image.fromarray(rgba, mode="RGBA")
    image.save(out_path)
    return image.size


async def _fetch_osm_forest(bbox: BBox) -> list[dict]:
    """Fetch forest polygons from OSM Overpass (natural=wood, landuse=forest)."""
    b = f"{bbox.min_lat},{bbox.min_lon},{bbox.max_lat},{bbox.max_lon}"
    query = (
        f"[out:json][timeout:60][bbox:{b}];\n"
        f"(\n"
        f'  way["natural"="wood"];\n'
        f'  way["landuse"="forest"];\n'
        f");\n"
        f"out body;\n"
        f">;\n"
        f"out skel qt;"
    )
    try:
        resp = await client.post(
            _OVERPASS_URL,
            data={"data": query},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=_OVERPASS_TIMEOUT,
        )
        resp.raise_for_status()
        elements: list[dict] = resp.json().get("elements", [])

        nodes: dict[int, tuple[float, float]] = {
            e["id"]: (e["lon"], e["lat"])
            for e in elements
            if e["type"] == "node"
        }

        features: list[dict] = []
        for e in elements:
            if e["type"] != "way":
                continue
            coords = [nodes[nid] for nid in e.get("nodes", []) if nid in nodes]
            if len(coords) < 4:
                continue
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            tags = e.get("tags", {})
            features.append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [coords]},
                "properties": {
                    "osm_id": e["id"],
                    "land_class": "forest",
                    "land_label": "Forest",
                    "nls_collection": "osm_forest",
                    "nls_label": tags.get("name", "Forest"),
                    "osm_natural": tags.get("natural", ""),
                    "osm_landuse": tags.get("landuse", ""),
                },
            })

        logger.info("OSM forest: %d polygon features", len(features))
        return features
    except Exception as exc:
        logger.warning("OSM forest fetch error: %s: %s", type(exc).__name__, exc)
        return []


async def _fetch_collection(collection_id: str, bbox: BBox) -> list[dict]:
    url = f"{_NLS_BASE}/collections/{collection_id}/items"
    params = {"bbox": str(bbox), "limit": _LIMIT, "f": "json"}
    try:
        auth = (MML_API_KEY, "") if MML_API_KEY else None
        resp = await client.get(url, params=params, auth=auth)
        resp.raise_for_status()
        features = resp.json().get("features", [])
        logger.info("NLS '%s': %d features", collection_id, len(features))
        return features
    except Exception as exc:
        logger.warning("NLS collection '%s' error: %s", collection_id, exc)
        return []


async def fetch_land(aoi_id: str, bbox: BBox) -> dict:
    """Fetch polygon land cover features and write to disk."""
    feature_counts: dict[str, int] = {}

    # --- Land cover polygon collections ---
    cover_features: list[dict] = []
    for collection_id, label in _LAND_COLLECTIONS:
        features = await _fetch_collection(collection_id, bbox)
        features = _annotate_features(features, collection_id, label)
        cover_features.extend(features)

    write_json(
        category_file(aoi_id, "land", "cover.geojson"),
        feature_collection(cover_features, source="NLS Finland — Topographic Database"),
    )
    feature_counts["cover.geojson"] = len(cover_features)

    # --- Buildings (separate file) ---
    building_features = await _fetch_collection("rakennus", bbox)
    building_features = _annotate_features(building_features, "rakennus", "Buildings")
    write_json(
        category_file(aoi_id, "land", "buildings.geojson"),
        feature_collection(building_features, source="NLS Finland — Topographic Database"),
    )
    feature_counts["buildings.geojson"] = len(building_features)

    # --- Forest polygons from OSM (NLS has no explicit polygon forest layer) ---
    forest_features = await _fetch_osm_forest(bbox)
    write_json(
        category_file(aoi_id, "land", "forest.geojson"),
        feature_collection(forest_features, source="OpenStreetMap / Overpass API"),
    )
    feature_counts["forest.geojson"] = len(forest_features)

    # --- Raster overlays ---
    cover_path = category_file(aoi_id, "land", "cover.png")
    if cover_features:
        sz = _write_land_png(cover_features, bbox, cover_path)
    else:
        sz = _write_empty_png(cover_path)
    feature_counts["cover.png"] = sz[0] * sz[1]

    forest_path = category_file(aoi_id, "land", "forest.png")
    sz = _write_forest_density_png(forest_features, bbox, forest_path)
    feature_counts["forest.png"] = sz[0] * sz[1]

    total_features = feature_counts["cover.geojson"] + feature_counts["buildings.geojson"]
    write_category_meta(
        aoi_id, "land",
        source="NLS Finland — Topographic Database",
        confidence="high" if total_features > 0 else "low",
        feature_counts=feature_counts,
    )
    return {"source": "NLS Finland", "feature_counts": feature_counts}
