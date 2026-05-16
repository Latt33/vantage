"""Cell tower data from the OpenCelliD API.

Queries the OpenCelliD 'getInArea' endpoint for all cell towers within
the bounding box for Finland (MCC=244) and writes them as a GeoJSON
FeatureCollection.

Requires: OPENCELLID_API_KEY environment variable.

Output files:
    {aoi_id}/cellular/towers.geojson   — GeoJSON FeatureCollection
    {aoi_id}/cellular/meta.json

Each tower is a Point Feature with properties:
    source, radio, mcc, net, cell, range, samples, changeable,
    created, updated
"""

import logging
import os
import math

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.storage import category_file, write_category_meta, write_json

logger = logging.getLogger(__name__)

OPENCELLID_API_KEY = os.getenv("OPENCELLID_API_KEY") or os.getenv("CELLS_API_KEY") or ""
_OPENCELLID_URL = "https://opencellid.org/cell/getInArea"

_FINLAND_MCC = 244
_MAX_BBOX_SQM = 4_000_000


def _bbox_area_m2(bbox: BBox) -> float:
    mid_lat = (bbox.min_lat + bbox.max_lat) / 2
    lat_m = abs(bbox.max_lat - bbox.min_lat) * 111_320.0
    lon_m = abs(bbox.max_lon - bbox.min_lon) * 111_320.0 * math.cos(math.radians(mid_lat))
    return abs(lat_m * lon_m)


def _split_bbox(bbox: BBox) -> list[BBox]:
    mid_lon = (bbox.min_lon + bbox.max_lon) / 2
    mid_lat = (bbox.min_lat + bbox.max_lat) / 2
    return [
        BBox(bbox.min_lon, bbox.min_lat, mid_lon, mid_lat),
        BBox(mid_lon, bbox.min_lat, bbox.max_lon, mid_lat),
        BBox(bbox.min_lon, mid_lat, mid_lon, bbox.max_lat),
        BBox(mid_lon, mid_lat, bbox.max_lon, bbox.max_lat),
    ]


async def _fetch_towers_bbox(bbox: BBox, limit: int = 2000, depth: int = 0) -> list[dict]:
    if _bbox_area_m2(bbox) > _MAX_BBOX_SQM and depth < 4:
        towers: list[dict] = []
        for part in _split_bbox(bbox):
            towers.extend(await _fetch_towers_bbox(part, limit=limit, depth=depth + 1))
        return towers

    params = {
        "key": OPENCELLID_API_KEY,
        "BBOX": f"{bbox.min_lat},{bbox.min_lon},{bbox.max_lat},{bbox.max_lon}",
        "mcc": _FINLAND_MCC,
        "format": "json",
        "limit": limit,
    }
    resp = await client.get(_OPENCELLID_URL, params=params)
    resp.raise_for_status()
    data = resp.json()

    if isinstance(data, dict) and data.get("status") == "error":
        message = data.get("message") or data.get("help") or "OpenCelliD returned an error"
        raise RuntimeError(str(message))

    if isinstance(data, list):
        towers = data
    elif isinstance(data, dict):
        for key in ("cells", "towers", "results", "data", "response"):
            value = data.get(key)
            if isinstance(value, list):
                towers = value
                break
        else:
            towers = []
    else:
        towers = []

    if len(towers) >= limit and depth < 4:
        merged: list[dict] = []
        for part in _split_bbox(bbox):
            merged.extend(await _fetch_towers_bbox(part, limit=limit, depth=depth + 1))
        return merged

    return towers


async def fetch_towers(aoi_id: str, bbox: BBox) -> dict:
    """Fetch cell towers from OpenCelliD and write as GeoJSON to disk."""
    if not OPENCELLID_API_KEY:
        logger.warning("OPENCELLID_API_KEY not set — skipping cell tower fetch")
        write_category_meta(
            aoi_id, "cellular",
            source="OpenCelliD",
            confidence="low",
            feature_counts={},
        )
        raise RuntimeError("Missing API Key")

    try:
        all_towers = await _fetch_towers_bbox(bbox)
        features = []
        for t in all_towers:
            lon = t.get("lon")
            lat = t.get("lat")

            if lon is None or lat is None:
                lon = t.get("longitude") or t.get("lng")
                lat = t.get("latitude")

            if (lon is None or lat is None) and isinstance(t.get("coordinates"), (list, tuple)):
                coords = t.get("coordinates")
                if len(coords) >= 2:
                    lon = coords[0]
                    lat = coords[1]

            if lon is None or lat is None:
                continue
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "source":     "OpenCelliD",
                    "radio":      t.get("radio"),
                    "mcc":        t.get("mcc"),
                    "net":        t.get("net"),
                    "cell":       t.get("cell"),
                    "range":      t.get("range"),
                    "samples":    t.get("samples"),
                    "changeable": t.get("changeable"),
                    "created":    t.get("created"),
                    "updated":    t.get("updated"),
                },
            })

        fc = {"type": "FeatureCollection", "features": features}
        write_json(category_file(aoi_id, "cellular", "towers.geojson"), fc)

        logger.info("OpenCelliD: %d towers → towers.geojson", len(features))

        write_category_meta(
            aoi_id, "cellular",
            source="OpenCelliD",
            confidence="high" if features else "low",
            feature_counts={"towers": len(features)},
        )
        return {"source": "OpenCelliD", "feature_counts": {"towers": len(features)}}

    except Exception as exc:
        logger.warning("OpenCelliD fetch error: %s", exc)
        write_json(category_file(aoi_id, "cellular", "towers.geojson"), {"type": "FeatureCollection", "features": []})
        write_category_meta(
            aoi_id, "cellular",
            source="OpenCelliD",
            confidence="low",
            feature_counts={"towers": 0},
        )
        return {"source": "OpenCelliD", "error": str(exc)}
