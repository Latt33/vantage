"""Infrastructure (Roads) from the National Land Survey of Finland (NLS).

Fetches the 'tieviiva' collection from the NLS OGC Features API.

Output files:
    {aoi_id}/infrastructure/roads.geojson
    {aoi_id}/infrastructure/meta.json
"""

import logging
import os
import math
import json
import httpx

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
_LIMIT = 50000


def _bbox_from_parts(bbox: BBox) -> list[BBox]:
    mid_lon = (bbox.min_lon + bbox.max_lon) / 2
    mid_lat = (bbox.min_lat + bbox.max_lat) / 2
    return [
        BBox(bbox.min_lon, bbox.min_lat, mid_lon, mid_lat),
        BBox(mid_lon, bbox.min_lat, bbox.max_lon, mid_lat),
        BBox(bbox.min_lon, mid_lat, mid_lon, bbox.max_lat),
        BBox(mid_lon, mid_lat, bbox.max_lon, bbox.max_lat),
    ]


async def _fetch_tieviiva_features(bbox: BBox, auth, depth: int = 0) -> list[dict]:
    url = f"{_NLS_BASE}/collections/tieviiva/items"
    params = {"bbox": str(bbox), "limit": 2000, "f": "json"}
    resp = await client.get(url, params=params, auth=auth)
    resp.raise_for_status()
    features = resp.json().get("features", [])

    if len(features) >= 2000 and depth < 3:
        merged: list[dict] = []
        for part in _bbox_from_parts(bbox):
            merged.extend(await _fetch_tieviiva_features(part, auth, depth + 1))
        return merged

    return features


def _haversine_length(coords: list[tuple[float, float]]) -> float:
    # returns length in meters for a sequence of lon,lat coordinates
    def _rad(x):
        return x * math.pi / 180.0

    total = 0.0
    for i in range(1, len(coords)):
        lon1, lat1 = coords[i - 1]
        lon2, lat2 = coords[i]
        dlat = _rad(lat2 - lat1)
        dlon = _rad(lon2 - lon1)
        a = math.sin(dlat / 2) ** 2 + math.cos(_rad(lat1)) * math.cos(_rad(lat2)) * math.sin(dlon / 2) ** 2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        R = 6371000.0
        total += R * c
    return total


def _feature_length_m(feature: dict) -> float:
    geom = feature.get("geometry") or {}
    if not geom:
        return 0.0
    typ = geom.get("type")
    coords = geom.get("coordinates")
    if typ == "LineString" and isinstance(coords, list):
        return _haversine_length(coords)
    if typ == "MultiLineString" and isinstance(coords, list):
        total = 0.0
        for part in coords:
            if isinstance(part, list):
                total += _haversine_length(part)
        return total
    return 0.0

async def fetch_infra(aoi_id: str, bbox: BBox) -> dict:
    """Fetch MML roads and write to disk. Returns a summary dict."""
    features = []
    try:
        auth = (MML_API_KEY, "") if MML_API_KEY else None
        features = await _fetch_tieviiva_features(bbox, auth)
    except Exception as exc:
        logger.warning("NLS tieviiva error: %s", exc)

    deduped: list[dict] = []
    seen: set[str] = set()
    for feature in features:
        key = json.dumps(
            {
                "geometry": feature.get("geometry"),
                "properties": feature.get("properties"),
            },
            sort_keys=True,
            default=str,
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(feature)
    features = deduped

    # compute length (meters) for each feature where applicable
    for f in features:
        try:
            length_m = int(_feature_length_m(f))
            props = f.setdefault("properties", {})
            props["length_m"] = length_m
        except Exception:
            # ignore length computation errors per feature
            pass

    write_json(
        category_file(aoi_id, "infrastructure", "roads.geojson"),
        feature_collection(features, source="NLS Finland — Tieviiva")
    )

    counts = {"roads.geojson": len(features)}
    logger.info("NLS infra: %d roads → infrastructure/", len(features))

    write_category_meta(
        aoi_id, "infrastructure",
        source="NLS Finland — Tieviiva",
        confidence="high" if features else "low",
        feature_counts=counts,
    )
    return {"source": "NLS Finland — Tieviiva", "feature_counts": counts}
