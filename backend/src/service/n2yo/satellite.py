"""Satellite Surveillance Predictor (N2YO API).

Fetches upcoming satellite passes over the Area of Interest.
The 'radiopasses' endpoint is used because it calculates line-of-sight passes
(satellite above horizon), not just visually bright passes.

Each pass is stored as a GeoJSON Point at the observer location (AoI centroid)
with temporal properties, making passes directly renderable on a map.

Output files:
    {aoi_id}/satellites/passes.geojson   — GeoJSON FeatureCollection (Points)
    {aoi_id}/satellites/meta.json

GeoJSON feature properties:
    source            "N2YO"
    satellite_name    human-readable satellite name
    norad_id          NORAD catalogue number (str)
    start_time        ISO 8601 UTC — pass start (satellite rises above min_elevation)
    max_elevation_deg peak elevation above horizon (degrees)
    max_time          ISO 8601 UTC — time of peak elevation
    end_time          ISO 8601 UTC — pass end (satellite drops below min_elevation)
    start_az_compass  compass direction at pass start (e.g. "NE")
    end_az_compass    compass direction at pass end
"""

import logging
import os
from datetime import datetime, timezone

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.geojson import feature, feature_collection, point
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


def _utc_to_iso(unix_ts: int | None) -> str | None:
    """Convert a UTC Unix timestamp to an ISO 8601 string, or None."""
    if unix_ts is None:
        return None
    return datetime.fromtimestamp(unix_ts, tz=timezone.utc).isoformat()


async def fetch_satellites(aoi_id: str, bbox: BBox) -> dict:
    """Fetch satellite pass schedules and write to disk as GeoJSON."""
    if not N2YO_API_KEY:
        logger.warning("N2YO_API_KEY not set — skipping satellite prediction.")
        fc = feature_collection([], source="N2YO")
        write_json(category_file(aoi_id, "satellites", "passes.geojson"), fc)
        write_category_meta(
            aoi_id, "satellites",
            source="N2YO Satellite API",
            confidence="low",
            feature_counts={"passes.geojson": 0},
        )
        return {"source": "N2YO Satellite API", "feature_counts": {"passes.geojson": 0}}

    center_lat = (bbox.min_lat + bbox.max_lat) / 2.0
    center_lon = (bbox.min_lon + bbox.max_lon) / 2.0
    observer_alt = 0    # metres above ground
    days = 3            # forecast window
    min_elevation = 20  # degrees above horizon threshold

    features = []

    for norad_id, sat_name in _TARGET_SATS.items():
        url = (
            f"{_N2YO_BASE}/{norad_id}/{center_lat}/{center_lon}"
            f"/{observer_alt}/{days}/{min_elevation}/&apiKey={N2YO_API_KEY}"
        )
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()

            for p in data.get("passes", []):
                props = {
                    "source": "N2YO",
                    "satellite_name": sat_name,
                    "norad_id": norad_id,
                    "start_time": _utc_to_iso(p.get("startUTC")),
                    "max_elevation_deg": p.get("maxEl"),
                    "max_time": _utc_to_iso(p.get("maxUTC")),
                    "end_time": _utc_to_iso(p.get("endUTC")),
                    "start_az_compass": p.get("startAzCompass"),
                    "end_az_compass": p.get("endAzCompass"),
                }
                features.append(feature(point(center_lon, center_lat), props))

        except Exception as exc:
            logger.warning("Failed to fetch passes for %s (%s): %s", sat_name, norad_id, exc)

    # Sort chronologically by start_time (None values sort last)
    features.sort(key=lambda f: f["properties"].get("start_time") or "")

    fc = feature_collection(features, source="N2YO")
    write_json(category_file(aoi_id, "satellites", "passes.geojson"), fc)

    n_passes = len(features)
    logger.info("N2YO Satellites: %d upcoming passes → passes.geojson", n_passes)

    write_category_meta(
        aoi_id, "satellites",
        source="N2YO Satellite API",
        confidence="high",
        feature_counts={"passes.geojson": n_passes},
    )
    return {"source": "N2YO Satellite API", "feature_counts": {"passes.geojson": n_passes}}
