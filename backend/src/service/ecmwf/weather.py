"""Weather forecast from ECMWF IFS via Open-Meteo — area grid coverage.

Fetches a 3-day hourly forecast for a regular grid of points within the
bounding box. ECMWF IFS native resolution is ~0.25° (~28 km), so grid
points are spaced at 0.25° intervals.

Output files:
    {aoi_id}/weather/forecast.parquet   — Parquet grid (WGS84)
    {aoi_id}/weather/meta.json

Parquet schema (one row per grid-point × time-step):
    lon              float64   degrees east (EPSG:4326)
    lat              float64   degrees north (EPSG:4326)
    valid_time       str       ISO 8601 UTC timestamp of the forecast step
    wind_speed_ms    float32   wind speed at 10 m (m/s)
    wind_dir_deg     float32   wind direction at 10 m (degrees from north)
    wind_gust_ms     float32   wind gust at 10 m (m/s)
    wind_speed_120m_ms   float32
    wind_dir_120m_deg    float32
    precipitation_mm float32   total precipitation (mm/h)
    rain_mm          float32
    snowfall_cm      float32
    snow_depth_m     float32
    soil_moisture_m3m3   float32
    visibility_m     float32   visibility (metres)
    weather_code     float32   WMO weather code
    cloudcover_pct   float32   total cloud cover (%)
    cloudcover_low_pct   float32
    cloudcover_mid_pct   float32
    cloudcover_high_pct  float32
    temperature_c    float32   temperature at 2 m (°C)
    apparent_temperature_c  float32
    humidity_pct     float32   relative humidity at 2 m (%)
    dewpoint_c       float32
    pressure_hpa     float32   surface pressure (hPa)
    freezing_level_m float32   freezing level height (m)
    soil_temperature_c   float32
    shortwave_radiation_wm2  float32

Source model: ECMWF IFS (European Centre for Medium-Range Weather Forecasts)
Proxy API:    Open-Meteo (https://open-meteo.com) — EU-hosted, no key required
"""

import logging
import math

import pandas as pd

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.formats import write_parquet_grid
from src.service._shared.storage import category_file, write_category_meta

logger = logging.getLogger(__name__)

_OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
_GRID_RESOLUTION = 0.25   # degrees — matches ECMWF IFS native resolution
_MAX_POINTS = 100         # guard against very large bboxes

_HOURLY_PARAMS = [
    "precipitation", "rain", "snowfall", "snow_depth", "soil_moisture_0_to_1cm",
    "windspeed_10m", "winddirection_10m", "windgusts_10m",
    "windspeed_120m", "winddirection_120m",
    "visibility", "cloudcover", "cloudcover_low", "cloudcover_mid", "cloudcover_high",
    "weather_code",
    "temperature_2m", "apparent_temperature", "relativehumidity_2m", "dewpoint_2m",
    "surface_pressure", "freezinglevel_height", "soil_temperature_0_to_7cm",
    "shortwave_radiation",
]

# Open-Meteo param name → canonical output column name
_PARAM_RENAME: dict[str, str] = {
    "windspeed_10m":             "wind_speed_ms",
    "winddirection_10m":         "wind_dir_deg",
    "windgusts_10m":             "wind_gust_ms",
    "windspeed_120m":            "wind_speed_120m_ms",
    "winddirection_120m":        "wind_dir_120m_deg",
    "precipitation":             "precipitation_mm",
    "rain":                      "rain_mm",
    "snowfall":                  "snowfall_cm",
    "snow_depth":                "snow_depth_m",
    "soil_moisture_0_to_1cm":    "soil_moisture_m3m3",
    "visibility":                "visibility_m",
    "weather_code":              "weather_code",
    "cloudcover":                "cloudcover_pct",
    "cloudcover_low":            "cloudcover_low_pct",
    "cloudcover_mid":            "cloudcover_mid_pct",
    "cloudcover_high":           "cloudcover_high_pct",
    "temperature_2m":            "temperature_c",
    "apparent_temperature":      "apparent_temperature_c",
    "relativehumidity_2m":       "humidity_pct",
    "dewpoint_2m":               "dewpoint_c",
    "surface_pressure":          "pressure_hpa",
    "freezinglevel_height":      "freezing_level_m",
    "soil_temperature_0_to_7cm": "soil_temperature_c",
    "shortwave_radiation":       "shortwave_radiation_wm2",
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

    if not points:
        clat = round((bbox.min_lat + bbox.max_lat) / 2, 6)
        clon = round((bbox.min_lon + bbox.max_lon) / 2, 6)
        points = [(clat, clon)]

    return points[:_MAX_POINTS]


async def fetch_weather(aoi_id: str, bbox: BBox) -> dict:
    """Fetch area weather grid and write to disk as Parquet. Returns a summary dict."""
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

    resp = await client.get(_OPEN_METEO_URL, params=params)
    resp.raise_for_status()
    raw = resp.json()

    # Normalise: single point → dict, multiple points → list[dict]
    results: list[dict] = raw if isinstance(raw, list) else [raw]

    # Times are identical across all grid points — take from the first result
    times: list[str] = results[0].get("hourly", {}).get("time", [])

    # Build flat row-per-(point, time) DataFrame
    rows: list[dict] = []
    for result in results:
        pt_lat = result.get("latitude")
        pt_lon = result.get("longitude")
        hourly = result.get("hourly", {})
        for t_idx, valid_time in enumerate(times):
            row: dict = {"lon": pt_lon, "lat": pt_lat, "valid_time": valid_time}
            for param in _HOURLY_PARAMS:
                col = _PARAM_RENAME.get(param, param)
                series = hourly.get(param, [])
                row[col] = series[t_idx] if t_idx < len(series) else None
            rows.append(row)

    df = pd.DataFrame(rows)
    # Cast all variable columns to float32 (lon/lat stay float64)
    for col in df.columns:
        if col not in ("lon", "lat", "valid_time"):
            df[col] = df[col].astype("float32")

    out_path = category_file(aoi_id, "weather", "forecast.parquet")
    write_parquet_grid(out_path, df)

    n_points = len(results)
    n_times = len(times)
    logger.info(
        "ECMWF weather: %d grid points × %d time steps → forecast.parquet",
        n_points, n_times,
    )
    write_category_meta(
        aoi_id, "weather",
        source="Open-Meteo / ECMWF IFS",
        confidence="high",
        feature_counts={"grid_points": n_points, "time_steps": n_times},
    )
    return {"source": "Open-Meteo / ECMWF IFS", "grid_points": n_points, "time_steps": n_times}
