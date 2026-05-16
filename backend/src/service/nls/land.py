"""Land cover features from the National Land Survey of Finland (NLS).

Fetches land cover (forest, open land, built areas) from the NLS OGC
Features API and writes it as a GeoJSON file.

Output files:
    {aoi_id}/land/cover.geojson   — NLS 'maanpeite' collection
    {aoi_id}/land/meta.json

Source:  https://www.maanmittauslaitos.fi/en
OGC API: https://avoin-karttakuva.maanmittauslaitos.fi/ogc/features/v2
"""

import logging

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

_NLS_BASE = "https://avoin-karttakuva.maanmittauslaitos.fi/ogc/features/v2"
_LIMIT = 500


async def fetch_land(aoi_id: str, bbox: BBox) -> dict:
    """Fetch land cover features and write to disk. Returns a summary dict."""
    url = f"{_NLS_BASE}/collections/maanpeite/items"
    params = {"bbox": str(bbox), "limit": _LIMIT, "f": "json"}

    features: list[dict] = []
    try:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        features = resp.json().get("features", [])
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            logger.warning("NLS collection 'maanpeite' not found — verify collection ID")
        else:
            logger.warning("NLS land HTTP %s", exc.response.status_code)
    except Exception as exc:
        logger.warning("NLS land error: %s", exc)

    fc = feature_collection(features, source="NLS Finland — Topographic Database")
    write_json(category_file(aoi_id, "land", "cover.geojson"), fc)
    logger.info("NLS land: %d features → cover.geojson", len(features))

    write_category_meta(
        aoi_id, "land",
        source="NLS Finland — Topographic Database",
        confidence="high" if features else "low",
        feature_counts={"cover.geojson": len(features)},
    )
    return {"source": "NLS Finland — Topographic Database", "feature_counts": {"cover.geojson": len(features)}}
