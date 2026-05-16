"""Water features from the National Land Survey of Finland (NLS).

Fetches water bodies (lakes, ponds) and watercourses (rivers, streams)
from the NLS OGC Features API and writes them as separate GeoJSON files.

Output files:
    {aoi_id}/water/bodies.geojson    — NLS 'vedet' collection
    {aoi_id}/water/courses.geojson   — NLS 'virtavedet' collection
    {aoi_id}/water/meta.json

Source:  https://www.maanmittauslaitos.fi/en
OGC API: https://avoin-karttakuva.maanmittauslaitos.fi/ogc/features/v2
"""

import logging

import os
import httpx

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.geojson import feature_collection
from src.service._shared.storage import (
    category_file,
    is_stale,
    write_category_meta,
    write_json,
)

logger = logging.getLogger(__name__)

_NLS_BASE = "https://avoin-paikkatieto.maanmittauslaitos.fi/maastotiedot/features/v1"
MML_API_KEY = os.getenv("MML_API_KEY", "")
_LIMIT = 500

# (collection_id, output_filename)
_COLLECTIONS = [
    ("vedet",       "bodies.geojson"),
    ("virtavedet",  "courses.geojson"),
]


async def _fetch_collection(collection_id: str, bbox: BBox) -> list[dict]:
    url = f"{_NLS_BASE}/collections/{collection_id}/items"
    params = {"bbox": str(bbox), "limit": _LIMIT, "f": "json"}
    try:
        auth = (MML_API_KEY, "") if MML_API_KEY else None
        resp = await client.get(url, params=params, auth=auth)
        resp.raise_for_status()
        return resp.json().get("features", [])
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            logger.warning("NLS collection '%s' not found — verify collection ID", collection_id)
        else:
            logger.warning("NLS collection '%s' HTTP %s", collection_id, exc.response.status_code)
        return []
    except Exception as exc:
        logger.warning("NLS collection '%s' error: %s", collection_id, exc)
        return []


async def fetch_water(aoi_id: str, bbox: BBox) -> dict:
    """Fetch water features and write to disk. Returns a summary dict."""
    feature_counts: dict[str, int] = {}

    for collection_id, filename in _COLLECTIONS:
        features = await _fetch_collection(collection_id, bbox)
        fc = feature_collection(features, source="NLS Finland — Topographic Database")
        write_json(category_file(aoi_id, "water", filename), fc)
        feature_counts[filename] = len(features)
        logger.info("NLS water: %d features → %s", len(features), filename)

    write_category_meta(
        aoi_id, "water",
        source="NLS Finland — Topographic Database",
        confidence="high" if any(n > 0 for n in feature_counts.values()) else "low",
        feature_counts=feature_counts,
    )
    return {"source": "NLS Finland — Topographic Database", "feature_counts": feature_counts}
