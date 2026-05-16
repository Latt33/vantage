# DEPRECATED — delete this file.
# Replaced by: backend/src/service/ecmwf/weather.py

"""Wind and weather forecast from ECMWF IFS via Open-Meteo.

Open-Meteo (https://open-meteo.com) is a European open-source weather API
hosted in Germany. It proxies ECMWF IFS model output as JSON with no
registration or API key required.

Source model: ECMWF IFS (European Centre for Medium-Range Weather Forecasts)
API docs:     https://open-meteo.com/en/docs

Returns 3-day hourly forecast at the BBox centroid as a GeoJSON FeatureCollection.
Each feature is a Point at the centroid with forecast values in properties.
"""

import logging

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.geojson import feature, feature_collection, point

logger = logging.getLogger(__name__)

_OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


def _centroid(bbox: BBox) -> tuple[float, float]:
    return (bbox.min_lon + bbox.max_lon) / 2, (bbox.min_lat + bbox.max_lat) / 2


async def fetch_wind(bbox: BBox) -> dict:
    """Return hourly wind, precipitation, and visibility forecast for the BBox centroid."""
    lon, lat = _centroid(bbox)

    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": ",".join([
            "windspeed_10m",
            "winddirection_10m",
            "precipitation",
            "visibility",
            "cloudcover",
            "temperature_2m",
        ]),
        "forecast_days": 3,
        "windspeed_unit": "ms",
        "models": "ecmwf_ifs04",
        "timezone": "Europe/Helsinki",
    }

    try:
        resp = await client.get(_OPEN_METEO_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

        hourly = data.get("hourly", {})
        times = hourly.get("time", [])

        def _get(key: str, i: int):
            col = hourly.get(key, [])
            return col[i] if i < len(col) else None

        features = [
            feature(
                point(lon, lat),
                {
                    "time": t,
                    "wind_speed_ms":      _get("windspeed_10m", i),
                    "wind_direction_deg": _get("winddirection_10m", i),
                    "precipitation_mm":   _get("precipitation", i),
                    "visibility_m":       _get("visibility", i),
                    "cloudcover_pct":     _get("cloudcover", i),
                    "temperature_c":      _get("temperature_2m", i),
                },
            )
            for i, t in enumerate(times)
        ]

        logger.info("ECMWF weather: %d hourly steps for centroid %.4f,%.4f", len(features), lat, lon)
        fc = feature_collection(features, source="Open-Meteo / ECMWF IFS")
        fc["confidence"] = "high"
        return fc

    except Exception as exc:
        logger.warning("ECMWF wind fetch failed: %s", exc)
        return {
            "type": "FeatureCollection",
            "features": [],
            "source": "Open-Meteo / ECMWF IFS",
            "confidence": "low",
            "status": "error",
            "error": str(exc),
        }
