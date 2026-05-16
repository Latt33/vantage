# DEPRECATED — delete this file.
# Split into: nls/water.py (water bodies + courses) and nls/land.py (land cover)

"""Terrain features from the National Land Survey of Finland (NLS / Maanmittauslaitos).

Source:   https://www.maanmittauslaitos.fi/en/maps-and-spatial-data/expert-users/product-descriptions/topographic-database
OGC API:  https://avoin-karttakuva.maanmittauslaitos.fi/ogc/features/v2

We fetch vector terrain features — water bodies, waterways, and land cover —
rather than raw elevation raster values. These are operationally more useful
for IPB (obstacle analysis, cover, water crossing points) and are available
as GeoJSON via the OGC Features API without authentication.

Collection IDs to verify against the live collections endpoint:
    GET https://avoin-karttakuva.maanmittauslaitos.fi/ogc/features/v2/collections

If a collection returns 404, check the live endpoint and update _COLLECTIONS.
"""

import logging

import httpx

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.geojson import feature_collection

logger = logging.getLogger(__name__)

_NLS_BASE = "https://avoin-karttakuva.maanmittauslaitos.fi/ogc/features/v2"

# (collection_id, human_label) — order determines fetch priority.
# Limit per collection kept low to avoid overloading the API during the demo.
_COLLECTIONS: list[tuple[str, str]] = [
    ("vedet",           "Water bodies"),        # lakes, ponds
    ("virtavedet",      "Waterways"),            # rivers, streams
    ("maanpeite",       "Land cover"),           # forest, open land
]
_LIMIT_PER_COLLECTION = 500


async def _fetch_collection(collection_id: str, bbox: BBox) -> list[dict]:
    """Fetch GeoJSON items from one NLS OGC Features collection.

    Returns an empty list on any error so the caller can aggregate results
    across collections without failing on individual ones.
    """
    url = f"{_NLS_BASE}/collections/{collection_id}/items"
    params = {"bbox": str(bbox), "limit": _LIMIT_PER_COLLECTION, "f": "json"}
    try:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        return resp.json().get("features", [])
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            logger.warning("NLS collection '%s' not found (404) — verify collection ID", collection_id)
        else:
            logger.warning("NLS collection '%s' HTTP %s", collection_id, exc.response.status_code)
        return []
    except Exception as exc:
        logger.warning("NLS collection '%s' fetch error: %s", collection_id, exc)
        return []


async def fetch_terrain(bbox: BBox) -> dict:
    """Return a merged GeoJSON FeatureCollection of NLS terrain features.

    Each feature gets a 'collection' property so the frontend can style
    water differently from forest, etc.
    """
    all_features: list[dict] = []

    for collection_id, label in _COLLECTIONS:
        raw_features = await _fetch_collection(collection_id, bbox)
        for f in raw_features:
            if "properties" not in f or f["properties"] is None:
                f["properties"] = {}
            f["properties"]["nls_collection"] = collection_id
            f["properties"]["nls_label"] = label
        all_features.extend(raw_features)
        logger.info("NLS terrain: %d features from collection '%s'", len(raw_features), collection_id)

    fc = feature_collection(all_features, source="NLS Finland — Topographic Database")
    fc["confidence"] = "high" if all_features else "low"
    return fc
