"""Cellular infrastructure from OpenCelliD.

Fetches towers by BBox, filtering for national operators (e.g. MCC=244).

Output files:
    {aoi_id}/cellular/towers.geojson
    {aoi_id}/cellular/meta.json
"""

import logging
import os

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.geojson import feature, feature_collection, point
from src.service._shared.storage import category_file, write_category_meta, write_json

logger = logging.getLogger(__name__)

OPENCELLID_API_KEY = os.getenv("OPENCELLID_API_KEY", "")

async def fetch_towers(aoi_id: str, bbox: BBox) -> dict:
    """Fetch cell towers from OpenCelliD and write to disk."""
    if not OPENCELLID_API_KEY:
        logger.warning("No OPENCELLID_API_KEY set, skipping OpenCelliD fetch.")
        return {"source": "OpenCelliD", "feature_counts": {"towers.geojson": 0}}

    url = "https://opencellid.org/cell/getInArea"
    
    params = {
        "key": OPENCELLID_API_KEY,
        "BBOX": f"{bbox.min_lat},{bbox.min_lon},{bbox.max_lat},{bbox.max_lon}",
        "mcc": "244", # Finland
        "format": "json",
        "limit": "1000"
    }

    try:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        logger.warning("OpenCelliD error: %s", exc)
        return {"source": "OpenCelliD", "feature_counts": {"towers.geojson": 0}}

    towers = []
    
    # Depending on API response format, extract cells array
    if isinstance(data, dict) and "error" in data:
         logger.warning("OpenCelliD returned error: %s", data["error"])
         elements = []
    elif isinstance(data, dict) and "cells" in data:
         elements = data.get("cells", [])
    elif isinstance(data, list):
         elements = data
    else:
         elements = []

    for cell in elements:
        try:
            lon = float(cell["lon"])
            lat = float(cell["lat"])
            # Estimate coverage radius based on range parameter if available
            coverage_radius = cell.get("range", 1000)
            props = {
                "radio": cell.get("radio"),
                "mcc": cell.get("mcc"),
                "mnc": cell.get("mnc"),
                "range": coverage_radius,
                "cellid": cell.get("cellid")
            }
            towers.append(feature(point(lon, lat), props))
        except (KeyError, ValueError, TypeError):
            continue

    write_json(
        category_file(aoi_id, "cellular", "towers.geojson"),
        feature_collection(towers, source="OpenCelliD")
    )
    
    counts = {"towers.geojson": len(towers)}
    logger.info("OpenCelliD: %d towers → cellular/", len(towers))

    write_category_meta(
        aoi_id, "cellular",
        source="OpenCelliD",
        confidence="medium" if towers else "low",
        feature_counts=counts,
    )
    return {"source": "OpenCelliD", "feature_counts": counts}
