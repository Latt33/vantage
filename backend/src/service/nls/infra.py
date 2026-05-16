"""Infrastructure (Roads) from the National Land Survey of Finland (NLS).

Fetches the 'tieverkko' collection from the NLS OGC Features API.

Output files:
    {aoi_id}/infrastructure/roads.geojson
    {aoi_id}/infrastructure/meta.json
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
_LIMIT = 2000

async def fetch_infra(aoi_id: str, bbox: BBox) -> dict:
    """Fetch MML roads and write to disk. Returns a summary dict."""
    url = f"{_NLS_BASE}/collections/tieverkko/items"
    params = {"bbox": str(bbox), "limit": _LIMIT, "f": "json"}
    
    features = []
    try:
        auth = (MML_API_KEY, "") if MML_API_KEY else None
        resp = await client.get(url, params=params, auth=auth)
        resp.raise_for_status()
        features = resp.json().get("features", [])
    except Exception as exc:
        logger.warning("NLS tieverkko error: %s", exc)

    write_json(
        category_file(aoi_id, "infrastructure", "roads.geojson"),
        feature_collection(features, source="NLS Finland — Tieverkko")
    )

    counts = {"roads.geojson": len(features)}
    logger.info("NLS infra: %d roads → infrastructure/", len(features))

    write_category_meta(
        aoi_id, "infrastructure",
        source="NLS Finland — Tieverkko",
        confidence="high" if features else "low",
        feature_counts=counts,
    )
    return {"source": "NLS Finland — Tieverkko", "feature_counts": counts}
