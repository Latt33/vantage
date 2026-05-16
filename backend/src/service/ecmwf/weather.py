"""Weather forecast from ECMWF IFS via Open-Meteo.

Open-Meteo (https://open-meteo.com) is a European open-source weather API
hosted in Germany. It proxies ECMWF IFS model output as JSON with no
registration or API key required.

All operationally relevant parameters are fetched in a single request.
The ECMWF IFS model runs at 0.25° (~28 km) resolution globally.

Source model: ECMWF IFS (European Centre for Medium-Range Weather Forecasts)
API docs:     https://open-meteo.com/en/docs
"""

import logging

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.geojson import feature, feature_collection, point

logger = logging.getLogger(__name__)

_OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

# All parameters fetched in one request.
# Grouped by operational relevance for readability.
_HOURLY_PARAMS = [
    # Mobility / trafficability
    "precipitation",            # mm — rain/sleet
    "snowfall",                 # cm — fresh snow
    "snow_depth",               # m — total snow on ground
    "soil_moisture_0_to_1cm",   # m³/m³ — surface saturation (off-road trafficability)
    "rain",                     # mm — rain only (separate from snow)
    # Air operations / surveillance
    "windspeed_10m",            # m/s
    "winddirection_10m",        # degrees from north (meteorological)
    "windgusts_10m",            # m/s — peak gust
    "visibility",               # m
    "cloudcover",               # % total
    "cloudcover_low",           # % below 2 km (relevant for rotary-wing ops)
    # Personnel / equipment
    "temperature_2m",           # °C
    "apparent_temperature",     # °C felt temperature
    "relativehumidity_2m",      # %
    "dewpoint_2m",              # °C — fog/frost risk indicator
    "surface_pressure",         # hPa — pressure trend
    "freezinglevel_height",     # m — 0°C isotherm altitude
]


def _centroid(bbox: BBox) -> tuple[float, float]:
    return (bbox.min_lon + bbox.max_lon) / 2, (bbox.min_lat + bbox.max_lat) / 2


async def fetch_weather(bbox: BBox) -> dict:
    """Return a 3-day hourly ECMWF forecast for the BBox centroid.

    Each GeoJSON feature represents one hour. The centroid point is used
    because ECMWF IFS resolution (~28 km) makes per-point fetching within
    a tactical bbox redundant — one forecast covers the whole area.
    """
    lon, lat = _centroid(bbox)

    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": ",".join(_HOURLY_PARAMS),
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

        def _val(key: str, i: int):
            col = hourly.get(key, [])
            return col[i] if i < len(col) else None

        features = [
            feature(
                point(lon, lat),
                {
                    "time": t,
                    # Mobility
                    "precipitation_mm":         _val("precipitation", i),
                    "rain_mm":                  _val("rain", i),
                    "snowfall_cm":              _val("snowfall", i),
                    "snow_depth_m":             _val("snow_depth", i),
                    "soil_moisture_m3m3":       _val("soil_moisture_0_to_1cm", i),
                    # Air operations
                    "wind_speed_ms":            _val("windspeed_10m", i),
                    "wind_direction_deg":        _val("winddirection_10m", i),
                    "wind_gust_ms":             _val("windgusts_10m", i),
                    "visibility_m":             _val("visibility", i),
                    "cloudcover_pct":           _val("cloudcover", i),
                    "cloudcover_low_pct":       _val("cloudcover_low", i),
                    # Personnel / equipment
                    "temperature_c":            _val("temperature_2m", i),
                    "apparent_temperature_c":   _val("apparent_temperature", i),
                    "humidity_pct":             _val("relativehumidity_2m", i),
                    "dewpoint_c":               _val("dewpoint_2m", i),
                    "pressure_hpa":             _val("surface_pressure", i),
                    "freezing_level_m":         _val("freezinglevel_height", i),
                },
            )
            for i, t in enumerate(times)
        ]

        logger.info(
            "ECMWF weather: %d hourly steps for centroid %.4f,%.4f",
            len(features), lat, lon,
        )
        fc = feature_collection(features, source="Open-Meteo / ECMWF IFS")
        fc["confidence"] = "high"
        return fc

    except Exception as exc:
        logger.warning("ECMWF weather fetch failed: %s", exc)
        return {
            "type": "FeatureCollection",
            "features": [],
            "source": "Open-Meteo / ECMWF IFS",
            "confidence": "low",
            "status": "error",
            "error": str(exc),
        }
