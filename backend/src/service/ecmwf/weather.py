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

import asyncio
import logging
import math
import os

import pandas as pd

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.formats import write_parquet_grid
from src.service._shared.storage import category_file, write_category_meta
from src.service.ecmwf.weather_backup import build_backup_weather_dataframe

logger = logging.getLogger(__name__)

# Serialise all Open-Meteo calls — their free tier 429s when multiple requests
# hit at the same time from the same IP, even across different AOIs.
_OPEN_METEO_SEMAPHORE = asyncio.Semaphore(1)

_OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
# ~9 km spacing at Finnish latitudes (60°N): 0.08° lat ≈ 8.9 km, 0.16° lon ≈ 8.9 km.
_GRID_RES_LAT = 0.08
_GRID_RES_LON = 0.16
_MAX_POINTS = 100         # guard against very large bboxes

# Operationally relevant parameters only — soil moisture/temperature, apparent
# temperature, dewpoint, surface pressure, and shortwave radiation dropped.
_HOURLY_PARAMS = [
    "precipitation",
    "snowfall",
    "snow_depth",
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
    "relativehumidity_2m",
    "freezinglevel_height",
]

_PARAM_RENAME: dict[str, str] = {
    "windspeed_10m":      "wind_speed_ms",
    "winddirection_10m":  "wind_dir_deg",
    "windgusts_10m":      "wind_gust_ms",
    "windspeed_120m":     "wind_speed_120m_ms",
    "winddirection_120m": "wind_dir_120m_deg",
    "precipitation":      "precipitation_mm",
    "snowfall":           "snowfall_cm",
    "snow_depth":         "snow_depth_m",
    "visibility":         "visibility_m",
    "weather_code":       "weather_code",
    "cloudcover":         "cloudcover_pct",
    "cloudcover_low":     "cloudcover_low_pct",
    "cloudcover_mid":     "cloudcover_mid_pct",
    "cloudcover_high":    "cloudcover_high_pct",
    "temperature_2m":     "temperature_c",
    "relativehumidity_2m": "humidity_pct",
    "freezinglevel_height": "freezing_level_m",
}

_ESSENTIAL_WEATHER_COLUMNS = {
    "valid_time",
    "wind_speed_ms",
    "wind_dir_deg",
    "wind_gust_ms",
}


def _env_true(name: str) -> bool:
    value = (os.getenv(name) or "").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _write_fallback_weather(aoi_id: str, points: list[tuple[float, float]], reason: str) -> dict:
    df = build_backup_weather_dataframe(points)
    out_path = category_file(aoi_id, "weather", "forecast.parquet")
    write_parquet_grid(out_path, df)

    time_steps = int(df["valid_time"].nunique()) if "valid_time" in df.columns else 0
    write_category_meta(
        aoi_id, "weather",
        source="Demo backup weather profile",
        confidence="medium",
        feature_counts={"grid_points": len(points), "time_steps": time_steps},
    )
    logger.info(
        "Fallback weather persisted: %d grid points × %d time steps (reason: %s)",
        len(points),
        time_steps,
        reason,
    )
    return {
        "source": "Demo backup weather profile",
        "fallback": True,
        "grid_points": len(points),
        "time_steps": time_steps,
        "reason": reason,
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


def _payload_to_dataframe(points: list[tuple[float, float]], payload: dict | list) -> pd.DataFrame:
    """Normalize Open-Meteo payload into the canonical forecast grid DataFrame."""
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
    if df.empty:
        return df

    float_cols = [c for c in df.columns if c not in ("lon", "lat", "valid_time")]
    df[float_cols] = df[float_cols].astype("float32")
    return df


def _live_weather_is_usable(df: pd.DataFrame) -> bool:
    """Reject empty or all-null live responses so demo fallback can take over."""
    if df.empty:
        return False
    if not _ESSENTIAL_WEATHER_COLUMNS.issubset(df.columns):
        return False
    if not df["valid_time"].notna().any():
        return False
    return (
        df["wind_speed_ms"].notna().any()
        and df["wind_dir_deg"].notna().any()
        and df["wind_gust_ms"].notna().any()
    )


async def fetch_weather(aoi_id: str, bbox: BBox) -> dict:
    """Fetch area weather grid and write as Parquet. Returns a summary dict.

    Uses Open-Meteo's multi-coordinate request format (comma-separated
    latitude/longitude lists in a single HTTP call). One call per AoI instead
    of one per grid point — avoids the 429 rate-limit that the per-point
    fan-out was triggering.
    """
    points = _grid_points(bbox)

    if _env_true("WEATHER_FORCE_FALLBACK"):
        logger.info("WEATHER_FORCE_FALLBACK enabled — skipping Open-Meteo and using fallback profile")
        return _write_fallback_weather(aoi_id, points, "forced by WEATHER_FORCE_FALLBACK")

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
        async with _OPEN_METEO_SEMAPHORE:
            # Retry up to 3 times on 429 with exponential backoff (2s, 4s, 8s).
            resp = None
            for attempt in range(3):
                resp = await client.get(_OPEN_METEO_URL, params=params)
                if resp.status_code != 429:
                    break
                wait = 2 ** (attempt + 1)
                logger.warning("Open-Meteo 429 — retrying in %ds (attempt %d/3)", wait, attempt + 1)
                await asyncio.sleep(wait)
        resp.raise_for_status()
        payload = resp.json()

        df = _payload_to_dataframe(points, payload)
        if not _live_weather_is_usable(df):
            raise ValueError("live weather payload missing usable wind data")

        out_path = category_file(aoi_id, "weather", "forecast.parquet")
        write_parquet_grid(out_path, df)

        time_steps = int(df["valid_time"].nunique()) if "valid_time" in df.columns else 0

        logger.info(
            "Open-Meteo weather: %d grid points × %d time steps → forecast.parquet (1 HTTP call)",
            len(points), time_steps,
        )

        write_category_meta(
            aoi_id, "weather",
            source="Open-Meteo (best_match)",
            confidence="high",
            feature_counts={"grid_points": len(points), "time_steps": time_steps},
        )
        return {
            "source": "Open-Meteo (best_match)",
            "grid_points": len(points),
            "time_steps": time_steps,
        }

    except Exception as exc:
        logger.warning("Open-Meteo weather fetch failed, using fallback profile: %s", exc)
        return _write_fallback_weather(aoi_id, points, str(exc))
