"""DEM (elevation) data from National Land Survey of Finland (NLS / Maanmittauslaitos).

Source: https://www.maanmittauslaitos.fi/en/maps-and-spatial-data/expert-users/product-descriptions/elevation-model-2-m
API:    https://avoin-karttakuva.maanmittauslaitos.fi/ogc/features/collections/

The NLS OGC Features API is the primary terrain source for Finland.
For areas outside Finland, fall back to copernicus/dem.py.

This module is intentionally self-contained. It imports only from _shared
and the Python stdlib. Deleting this file breaks only the orchestrator import.
"""

import logging

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.geojson import feature_collection

logger = logging.getLogger(__name__)

# NLS OGC API — no API key required for open data collections
_NLS_BASE = "https://avoin-karttakuva.maanmittauslaitos.fi/ogc/features/v2"
_COLLECTION = "korkeusmalli_2m"  # 2 m resolution DEM grid points


async def fetch_dem(bbox: BBox) -> dict:
    """Return a GeoJSON FeatureCollection of elevation sample points for the bbox.

    The NLS OGC Features API returns JSON-LD / GeoJSON items. We request
    the bounding box filter and cap at 500 features for demo purposes.

    Returns a stub with status 'not_implemented' if the API call fails,
    so the pipeline continues even when this service is unavailable.
    """
    url = f"{_NLS_BASE}/collections/{_COLLECTION}/items"
    params = {
        "bbox": str(bbox),          # "min_lon,min_lat,max_lon,max_lat"
        "limit": 500,
        "f": "json",
    }

    try:
        response = await client.get(url, params=params)
        response.raise_for_status()
        data = response.json()
        features = data.get("features", [])
        logger.info("NLS DEM: fetched %d features for bbox %s", len(features), bbox)
        return feature_collection(features, source="NLS Finland — 2 m DEM")
    except Exception as exc:
        logger.warning("NLS DEM fetch failed: %s", exc)
        return {
            "type": "FeatureCollection",
            "features": [],
            "source": "NLS Finland — 2 m DEM",
            "status": "error",
            "error": str(exc),
        }
