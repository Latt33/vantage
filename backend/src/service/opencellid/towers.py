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

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.storage import category_file, write_category_meta, write_json

logger = logging.getLogger(__name__)

OPENCELLID_API_KEY = os.getenv("OPENCELLID_API_KEY", "")
_OPENCELLID_URL = "https://opencellid.org/cell/getInArea"

_FINLAND_MCC = 244


async def fetch_towers(aoi_id: str, bbox: BBox) -> dict:
    """Fetch cell towers from OpenCelliD and write as GeoJSON to disk."""
    if not OPENCELLID_API_KEY:
        logger.warning("OPENCELLID_API_KEY not set — skipping cell tower fetch")
        fc = {"type": "FeatureCollection", "features": []}
        write_json(category_file(aoi_id, "cellular", "towers.geojson"), fc)
        write_category_meta(
            aoi_id, "cellular",
            source="OpenCelliD",
            confidence="low",
            feature_counts={"towers": 0},
        )
        return {"source": "OpenCelliD", "error": "Missing API Key"}

    params = {
        "key":    OPENCELLID_API_KEY,
        "BBOX":   f"{bbox.min_lat},{bbox.min_lon},{bbox.max_lat},{bbox.max_lon}",
        "mcc":    _FINLAND_MCC,
        "format": "json",
        "limit":  2000,
    }

    try:
        resp = await client.get(_OPENCELLID_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

        towers = data.get("cells", [])
        features = []
        for t in towers:
            lon = t.get("lon")
            lat = t.get("lat")
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
        write_category_meta(
            aoi_id, "cellular",
            source="OpenCelliD",
            confidence="low",
            feature_counts={},
        )
        return {"source": "OpenCelliD", "error": str(exc)}
