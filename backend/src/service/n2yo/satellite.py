"""Satellite Surveillance Predictor (N2YO API).

Fetches upcoming satellite passes over the Area of Interest using the
N2YO 'radiopasses' endpoint (above-horizon passes, not just visual ones).

Output files:
    {aoi_id}/satellites/passes.geojson   — GeoJSON FeatureCollection
    {aoi_id}/satellites/meta.json

Each pass is a Point Feature at the AoI observer centroid.  Properties
follow the schema in data_types.md:
    source, satellite_name, norad_id, start_time, max_elevation_deg,
    max_time, end_time, start_az_compass, end_az_compass
"""

import logging
import os

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.storage import category_file, write_category_meta, write_json

logger = logging.getLogger(__name__)

N2YO_API_KEY = os.getenv("N2YO_API_KEY", "")
_N2YO_BASE = "https://api.n2yo.com/rest/v1/satellite/radiopasses"

_TARGET_SATS = {
    "25544": "ISS (Zarya) - Testing",
    "39634": "Sentinel-1A (ESA Radar)",
    "40019": "Resurs-P 2 (Russian Optical)",
    "49044": "Landsat 9 (US Optical)",
}


async def fetch_satellites(aoi_id: str, bbox: BBox) -> dict:
    """Fetch satellite pass schedules and write as GeoJSON to disk."""
    if not N2YO_API_KEY:
        logger.warning("N2YO_API_KEY not set — skipping satellite prediction")
        return {"source": "N2YO Satellite API", "error": "Missing API Key"}

    center_lat = (bbox.min_lat + bbox.max_lat) / 2.0
    center_lon = (bbox.min_lon + bbox.max_lon) / 2.0
    observer_alt = 0
    days = 3
    min_elevation = 20

    features = []

    for norad_id, name in _TARGET_SATS.items():
        url = (
            f"{_N2YO_BASE}/{norad_id}/{center_lat}/{center_lon}"
            f"/{observer_alt}/{days}/{min_elevation}/&apiKey={N2YO_API_KEY}"
        )
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()

            for p in data.get("passes", []):
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [center_lon, center_lat],
                    },
                    "properties": {
                        "source": "N2YO",
                        "satellite_name": name,
                        "norad_id": norad_id,
                        "start_time": p.get("startUTC"),
                        "max_elevation_deg": p.get("maxEl"),
                        "max_time": p.get("maxUTC"),
                        "end_time": p.get("endUTC"),
                        "start_az_compass": p.get("startAzCompass"),
                        "end_az_compass": p.get("endAzCompass"),
                    },
                })
        except Exception as exc:
            logger.warning("Failed to fetch passes for %s (%s): %s", name, norad_id, exc)

    features.sort(key=lambda f: f["properties"].get("start_time") or 0)

    fc = {"type": "FeatureCollection", "features": features}
    write_json(category_file(aoi_id, "satellites", "passes.geojson"), fc)

    logger.info("N2YO Satellites: %d upcoming passes → passes.geojson", len(features))

    write_category_meta(
        aoi_id, "satellites",
        source="N2YO Satellite API",
        confidence="high",
        feature_counts={"total_passes": len(features)},
    )
    return {"source": "N2YO Satellite API", "feature_counts": {"total_passes": len(features)}}
