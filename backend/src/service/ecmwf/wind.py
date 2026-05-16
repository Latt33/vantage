"""Wind and weather data from the European Centre for Medium-Range Weather Forecasts (ECMWF).

Source: https://www.ecmwf.int/en/forecasts/datasets/open-data
API:    ECMWF Open Data — no API key required for the public open-data endpoint.

Returns a forecast of 10 m wind speed and direction (u/v components) for the
centroid of the given BBox. Enough for Phase 1 operational context.

This module imports only from _shared. Deleting it breaks only the orchestrator.
"""

import logging
import math

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.geojson import feature, feature_collection, point

logger = logging.getLogger(__name__)

# ECMWF Open Data — public endpoint, no registration required
_ECMWF_BASE = "https://data.ecmwf.int/forecasts"


def _centroid(bbox: BBox) -> tuple[float, float]:
    lon = (bbox.min_lon + bbox.max_lon) / 2
    lat = (bbox.min_lat + bbox.max_lat) / 2
    return lon, lat


def _wind_direction_degrees(u: float, v: float) -> float:
    """Convert u/v wind components to meteorological wind direction (degrees from north)."""
    return (270 - math.degrees(math.atan2(v, u))) % 360


def _wind_speed_ms(u: float, v: float) -> float:
    return math.sqrt(u**2 + v**2)


async def fetch_wind(bbox: BBox) -> dict:
    """Return a GeoJSON FeatureCollection with a wind observation point at the BBox centroid.

    ECMWF Open Data provides GRIB2 files — parsing those inline is complex.
    For Phase 1 we use the Open-Meteo API (https://open-meteo.com) as a
    lightweight proxy to ECMWF IFS model data. Open-Meteo is a European
    open-source project (hosted in Germany) and serves ECMWF model output
    via a simple JSON API with no key required.
    """
    lon, lat = _centroid(bbox)

    # Open-Meteo — European open-source weather API proxying ECMWF IFS
    # https://open-meteo.com/en/docs
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "windspeed_10m,winddirection_10m,precipitation,visibility",
        "forecast_days": 3,
        "windspeed_unit": "ms",
        "models": "ecmwf_ifs04",  # explicitly request ECMWF IFS model
        "timezone": "Europe/Helsinki",
    }

    try:
        response = await client.get(url, params=params)
        response.raise_for_status()
        data = response.json()

        hourly = data.get("hourly", {})
        times = hourly.get("time", [])
        speeds = hourly.get("windspeed_10m", [])
        directions = hourly.get("winddirection_10m", [])
        precip = hourly.get("precipitation", [])
        visibility = hourly.get("visibility", [])

        features = []
        for i, t in enumerate(times):
            props = {
                "time": t,
                "wind_speed_ms": speeds[i] if i < len(speeds) else None,
                "wind_direction_deg": directions[i] if i < len(directions) else None,
                "precipitation_mm": precip[i] if i < len(precip) else None,
                "visibility_m": visibility[i] if i < len(visibility) else None,
            }
            features.append(feature(point(lon, lat), props))

        logger.info("ECMWF wind: fetched %d hourly forecasts for %.4f,%.4f", len(features), lat, lon)
        return feature_collection(features, source="Open-Meteo / ECMWF IFS")

    except Exception as exc:
        logger.warning("ECMWF wind fetch failed: %s", exc)
        return {
            "type": "FeatureCollection",
            "features": [],
            "source": "Open-Meteo / ECMWF IFS",
            "status": "error",
            "error": str(exc),
        }
