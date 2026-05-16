"""Land cover features from the National Land Survey of Finland (NLS).

Fetches land cover (forest, buildings) from the NLS OGC Features API.

Output files:
    {aoi_id}/land/cover.geojson      — NLS 'metsamaankasvillisuus' collection
    {aoi_id}/land/buildings.geojson  — NLS 'rakennus' collection
    {aoi_id}/land/meta.json
"""

import logging
import os
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
_LIMIT = 1000

_COLLECTIONS = [
    ("metsamaankasvillisuus", "cover.geojson"),
    ("rakennus",              "buildings.geojson"),
]


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

    for collection_id, filename in _COLLECTIONS:
        features = await _fetch_collection(collection_id, bbox)
        fc = feature_collection(features, source="NLS Finland — Topographic Database")
        write_json(category_file(aoi_id, "land", filename), fc)
        feature_counts[filename] = len(features)
        logger.info("NLS land: %d features → %s", len(features), filename)

    write_category_meta(
        aoi_id, "land",
        source="NLS Finland — Topographic Database",
        confidence="high" if any(n > 0 for n in feature_counts.values()) else "low",
        feature_counts=feature_counts,
    )
    return {"source": "NLS Finland", "feature_counts": feature_counts}
