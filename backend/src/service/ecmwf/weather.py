"""Weather forecast from ECMWF IFS via Open-Meteo — area grid coverage.

Fetches a 3-day hourly forecast for a regular grid of points within the
bounding box, not just the centroid. ECMWF IFS resolution is ~0.25° (~28 km),
so grid points are spaced at 0.25° intervals.

All variables are fetched in a single Open-Meteo request per grid point.
Open-Meteo accepts an array of lat/lon pairs, returning one result per point.

Output is stored as a WeatherGrid JSON (not GeoJSON) since the data is
inherently a 3-D field (lat × lon × time), not a collection of discrete features.

Output files:
    {aoi_id}/weather/forecast.json   — WeatherGrid structure
    {aoi_id}/weather/meta.json

WeatherGrid schema:
    {
        "type": "WeatherGrid",
        "source": "...",
        "model": "ecmwf_ifs04",
        "grid": {
            "points": [{"lat": ..., "lon": ...}, ...],
            "times":  ["2024-01-01T00:00", ...]
        },
        "variables": {
            "wind_speed_ms": [[point0_t0, point0_t1, ...], [point1_t0, ...]],
            ...
        }
    }

Indexing: variables[var][point_index][time_index]

Source model: ECMWF IFS (European Centre for Medium-Range Weather Forecasts)
Proxy API:    Open-Meteo (https://open-meteo.com) — EU-hosted, no key required
"""

import logging
import math

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.storage import category_file, write_category_meta, write_json

logger = logging.getLogger(__name__)

_OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
_GRID_RESOLUTION = 0.25   # degrees — matches ECMWF IFS native resolution
_MAX_POINTS = 100         # guard against very large bboxes

_HOURLY_PARAMS = [
    # Mobility / trafficability
    "precipitation",
    "rain",
    "snowfall",
    "snow_depth",
    "soil_moisture_0_to_1cm",
    # Air operations / surveillance
    "windspeed_10m",
    "winddirection_10m",
    "windgusts_10m",
    "visibility",
    "cloudcover",
    "cloudcover_low",
    # Personnel / equipment
    "temperature_2m",
    "apparent_temperature",
    "relativehumidity_2m",
    "dewpoint_2m",
    "surface_pressure",
    "freezinglevel_height",
]

# Mapping from Open-Meteo param name to output key name
_PARAM_RENAME: dict[str, str] = {
    "windspeed_10m":          "wind_speed_ms",
    "winddirection_10m":      "wind_direction_deg",
    "windgusts_10m":          "wind_gust_ms",
    "precipitation":          "precipitation_mm",
    "rain":                   "rain_mm",
    "snowfall":               "snowfall_cm",
    "snow_depth":             "snow_depth_m",
    "soil_moisture_0_to_1cm": "soil_moisture_m3m3",
    "visibility":             "visibility_m",
    "cloudcover":             "cloudcover_pct",
    "cloudcover_low":         "cloudcover_low_pct",
    "temperature_2m":         "temperature_c",
    "apparent_temperature":   "apparent_temperature_c",
    "relativehumidity_2m":    "humidity_pct",
    "dewpoint_2m":            "dewpoint_c",
    "surface_pressure":       "pressure_hpa",
    "freezinglevel_height":   "freezing_level_m",
}


def _grid_points(bbox: BBox) -> list[tuple[float, float]]:
    """Generate lat/lon grid points within bbox at ECMWF resolution."""
    res = _GRID_RESOLUTION

    def _snap_up(v: float) -> float:
        return math.ceil(v / res) * res

    points: list[tuple[float, float]] = []
    lat = _snap_up(bbox.min_lat)
    while lat <= bbox.max_lat + 1e-9:
        lon = _snap_up(bbox.min_lon)
        while lon <= bbox.max_lon + 1e-9:
            points.append((round(lat, 6), round(lon, 6)))
            lon = round(lon + res, 6)
        lat = round(lat + res, 6)

    # If bbox is smaller than one grid cell, fall back to centroid
    if not points:
        clat = round((bbox.min_lat + bbox.max_lat) / 2, 6)
        clon = round((bbox.min_lon + bbox.max_lon) / 2, 6)
        points = [(clat, clon)]

    return points[:_MAX_POINTS]


async def fetch_weather(aoi_id: str, bbox: BBox) -> dict:
    """Fetch area weather grid and write to disk. Returns a summary dict."""
    points = _grid_points(bbox)
    lats = [p[0] for p in points]
    lons = [p[1] for p in points]

    params = {
        "latitude":       ",".join(str(v) for v in lats),
        "longitude":      ",".join(str(v) for v in lons),
        "hourly":         ",".join(_HOURLY_PARAMS),
        "forecast_days":  3,
        "windspeed_unit": "ms",
        "models":         "ecmwf_ifs04",
        "timezone":       "Europe/Helsinki",
    }

    try:
        resp = await client.get(_OPEN_METEO_URL, params=params)
        resp.raise_for_status()
        raw = resp.json()

        # Normalise: single point returns dict, multiple returns list
        results: list[dict] = raw if isinstance(raw, list) else [raw]

        # Times are identical across all points — take from first
        times: list[str] = results[0].get("hourly", {}).get("time", [])

        # Build variables dict: var_name → list-per-point of time-series lists
        variables: dict[str, list[list]] = {
            _PARAM_RENAME.get(param, param): []
            for param in _HOURLY_PARAMS
        }

        grid_points_out: list[dict] = []
        for result in results:
            hourly = result.get("hourly", {})
            grid_points_out.append({
                "lat": result.get("latitude"),
                "lon": result.get("longitude"),
            })
            for param in _HOURLY_PARAMS:
                key = _PARAM_RENAME.get(param, param)
                variables[key].append(hourly.get(param, []))

        forecast = {
            "type": "WeatherGrid",
            "source": "Open-Meteo / ECMWF IFS",
            "model": "ecmwf_ifs04",
            "grid": {
                "points": grid_points_out,
                "times": times,
            },
            "variables": variables,
        }

        write_json(category_file(aoi_id, "weather", "forecast.json"), forecast)
        logger.info(
            "ECMWF weather: %d grid points × %d time steps → forecast.json",
            len(grid_points_out), len(times),
        )

        write_category_meta(
            aoi_id, "weather",
            source="Open-Meteo / ECMWF IFS",
            confidence="high",
            feature_counts={"grid_points": len(grid_points_out), "time_steps": len(times)},
        )
        return {
            "source": "Open-Meteo / ECMWF IFS",
            "grid_points": len(grid_points_out),
            "time_steps": len(times),
        }

    except Exception as exc:
        logger.warning("ECMWF weather fetch failed: %s", exc)
        write_category_meta(
            aoi_id, "weather",
            source="Open-Meteo / ECMWF IFS",
            confidence="low",
            feature_counts={},
        )
        return {"source": "Open-Meteo / ECMWF IFS", "error": str(exc)}
