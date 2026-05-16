"""Satellite Surveillance Predictor (N2YO API)

Fetches upcoming satellite passes over the Area of Interest.
We use the 'radiopasses' endpoint because it calculates anytime the satellite
is above the horizon (line of sight), whereas 'visualpasses' only calculates
when the satellite is illuminated by the sun in a dark sky (for human stargazing).

Output files:
    {aoi_id}/satellites/passes.json
    {aoi_id}/satellites/meta.json
"""

import logging
import os
import httpx

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.storage import (
    category_file,
    write_category_meta,
    write_json,
)

logger = logging.getLogger(__name__)

N2YO_API_KEY = os.getenv("N2YO_API_KEY", "")
_N2YO_BASE = "https://api.n2yo.com/rest/v1/satellite/radiopasses"

# NORAD IDs for interesting reconnaissance/observation satellites
_TARGET_SATS = {
    "25544": "ISS (Zarya) - Testing",
    "39634": "Sentinel-1A (ESA Radar)",
    "40019": "Resurs-P 2 (Russian Optical)",
    "49044": "Landsat 9 (US Optical)"
}

async def fetch_satellites(aoi_id: str, bbox: BBox) -> dict:
    """Fetch satellite pass schedules and write to disk."""
    if not N2YO_API_KEY:
        logger.warning("N2YO_API_KEY not set. Skipping satellite prediction.")
        return {"source": "N2YO Satellite API", "error": "Missing API Key"}

    # Use the centroid of the BBox as the observer location
    center_lat = (bbox.min_lat + bbox.max_lat) / 2.0
    center_lon = (bbox.min_lon + bbox.max_lon) / 2.0
    observer_alt = 0  # meters
    days = 3          # forecast window
    min_elevation = 20 # degrees above horizon to be considered a threat

    all_passes = []

    for norad_id, name in _TARGET_SATS.items():
        url = f"{_N2YO_BASE}/{norad_id}/{center_lat}/{center_lon}/{observer_alt}/{days}/{min_elevation}/&apiKey={N2YO_API_KEY}"
        
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
            
            passes = data.get("passes", [])
            for p in passes:
                all_passes.append({
                    "satellite_name": name,
                    "norad_id": norad_id,
                    "start_time": p.get("startUTC"),
                    "start_az": p.get("startAz"),
                    "start_az_compass": p.get("startAzCompass"),
                    "max_time": p.get("maxUTC"),
                    "max_elevation": p.get("maxEl"),
                    "max_az": p.get("maxAz"),
                    "max_az_compass": p.get("maxAzCompass"),
                    "end_time": p.get("endUTC"),
                    "end_az": p.get("endAz"),
                    "end_az_compass": p.get("endAzCompass"),
                })
        except Exception as exc:
            logger.warning("Failed to fetch passes for %s (%s): %s", name, norad_id, exc)

    # Sort passes chronologically by start time
    all_passes.sort(key=lambda x: x.get("start_time", 0))

    schedule_data = {
        "observer": {"lat": center_lat, "lon": center_lon},
        "passes": all_passes
    }

    write_json(category_file(aoi_id, "satellites", "passes.json"), schedule_data)
    
    logger.info("N2YO Satellites: Found %d upcoming passes", len(all_passes))

    counts = {"total_passes": len(all_passes)}
    write_category_meta(
        aoi_id, "satellites",
        source="N2YO Satellite API",
        confidence="high",
        feature_counts=counts,
    )
    return {"source": "N2YO Satellite API", "feature_counts": counts}
