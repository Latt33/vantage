"""Weather forecast via Open-Meteo — area grid coverage.

Fetches a 3-day hourly forecast for a regular grid of points within the
bounding box. Grid spacing is ~9 km (0.08° lat × 0.16° lon at 60°N), giving
roughly 10–20 points across a 30×30 km AoI.

Open-Meteo `best_match` is used so the proxy picks the highest-resolution
model available per location — for Nordic AoIs this is typically MET Norway
Nordic (2.5 km); elsewhere in the EU it falls back to DWD ICON-EU (6 km) or
ECMWF IFS (0.25°). The previous `ecmwf_ifs04` model name is deprecated and
returns nulls for every variable.

Output is a flat Parquet grid: one row per (grid-point × time-step).
The API layer converts Parquet to GeoJSON on demand.

Output files:
    {aoi_id}/weather/forecast.parquet
    {aoi_id}/weather/meta.json

Schema (one row per grid-point × time-step):
    lon             float64   degrees east
    lat             float64   degrees north
    valid_time      str       ISO 8601 local (Europe/Helsinki)
    wind_speed_ms   float32   m/s at 10 m
    wind_dir_deg    float32   degrees from north at 10 m
    wind_gust_ms    float32   m/s at 10 m
    ... (see _PARAM_RENAME for full list)

Proxy API: Open-Meteo (https://open-meteo.com) — EU-hosted, no key required
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
# ~9 km spacing at Finnish latitudes (60°N): 0.08° lat ≈ 8.9 km, 0.16° lon ≈ 8.9 km.
# At lower latitudes the lon spacing in km shrinks slightly — acceptable, the goal
# is "as many readings from the AOI as possible" at ≈9 km, not exact spacing.
_GRID_RES_LAT = 0.08
_GRID_RES_LON = 0.16
_MAX_POINTS = 100         # guard against very large bboxes

_HOURLY_PARAMS = [
    "precipitation",
    "rain",
    "snowfall",
    "snow_depth",
    "soil_moisture_0_to_1cm",
    "windspeed_10m",
    "winddirection_10m",
    "windgusts_10m",
    "windspeed_120m",
    "winddirection_120m",
    "visibility",
    "cloudcover",
    "cloudcover_low",
    "cloudcover_mid",
    "cloudcover_high",
    "weather_code",
    "temperature_2m",
    "apparent_temperature",
    "relativehumidity_2m",
    "dewpoint_2m",
    "surface_pressure",
    "freezinglevel_height",
    "soil_temperature_0_to_7cm",
    "shortwave_radiation",
]

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
    def _snap_up(v: float, res: float) -> float:
        return math.ceil(v / res) * res

    points: list[tuple[float, float]] = []
    lat = _snap_up(bbox.min_lat, _GRID_RES_LAT)
    while lat <= bbox.max_lat + 1e-9:
        lon = _snap_up(bbox.min_lon, _GRID_RES_LON)
        while lon <= bbox.max_lon + 1e-9:
            points.append((round(lat, 6), round(lon, 6)))
            lon = round(lon + _GRID_RES_LON, 6)
        lat = round(lat + _GRID_RES_LAT, 6)

    if not points:
        clat = round((bbox.min_lat + bbox.max_lat) / 2, 6)
        clon = round((bbox.min_lon + bbox.max_lon) / 2, 6)
        points = [(clat, clon)]

    return points[:_MAX_POINTS]


async def fetch_weather(aoi_id: str, bbox: BBox) -> dict:
    """Fetch area weather grid and write as Parquet. Returns a summary dict.

    Uses Open-Meteo's multi-coordinate request format (comma-separated
    latitude/longitude lists in a single HTTP call). One call per AoI instead
    of one per grid point — avoids the 429 rate-limit that the per-point
    fan-out was triggering.
    """
    points = _grid_points(bbox)

    params = {
        "latitude":       ",".join(f"{lat:.6f}" for lat, _ in points),
        "longitude":      ",".join(f"{lon:.6f}" for _, lon in points),
        "hourly":         ",".join(_HOURLY_PARAMS),
        "forecast_days":  3,
        "windspeed_unit": "ms",
        "models":         "best_match",
        "timezone":       "Europe/Helsinki",
    }

    try:
        resp = await client.get(_OPEN_METEO_URL, params=params)
        resp.raise_for_status()
        payload = resp.json()

        # Open-Meteo returns a list when multiple coordinates are requested,
        # a single object when only one. Normalise to a list.
        results: list[dict] = payload if isinstance(payload, list) else [payload]

        times: list[str] = results[0].get("hourly", {}).get("time", []) if results else []

        rows = []
        for (pt_lat, pt_lon), result in zip(points, results):
            hourly = result.get("hourly", {})
            for t_idx, time_str in enumerate(times):
                row: dict = {"lon": pt_lon, "lat": pt_lat, "valid_time": time_str}
                for param in _HOURLY_PARAMS:
                    key = _PARAM_RENAME.get(param, param)
                    series = hourly.get(param, [])
                    row[key] = series[t_idx] if t_idx < len(series) else None
                rows.append(row)

        df = pd.DataFrame(rows)
        float_cols = [c for c in df.columns if c not in ("lon", "lat", "valid_time")]
        df[float_cols] = df[float_cols].astype("float32")

        out_path = category_file(aoi_id, "weather", "forecast.parquet")
        write_parquet_grid(out_path, df)

        logger.info(
            "Open-Meteo weather: %d grid points × %d time steps → forecast.parquet (1 HTTP call)",
            len(results), len(times),
        )

        write_category_meta(
            aoi_id, "weather",
            source="Open-Meteo (best_match)",
            confidence="high",
            feature_counts={"grid_points": len(points), "time_steps": len(times)},
        )
        return {
            "source": "Open-Meteo (best_match)",
            "grid_points": len(points),
            "time_steps": len(times),
        }

    except Exception as exc:
        logger.warning("Open-Meteo weather fetch failed: %s", exc)
        write_category_meta(
            aoi_id, "weather",
            source="Open-Meteo (best_match)",
            confidence="low",
            feature_counts={},
        )
        return {"source": "Open-Meteo (best_match)", "error": str(exc)}
