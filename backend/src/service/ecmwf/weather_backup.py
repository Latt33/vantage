"""Demo weather fallback for hackathon use.

Generates a believable but location-agnostic hourly weather profile for the
next 72 hours and expands it across the weather grid points used by the live
Open-Meteo fetch path. The goal is to preserve the same parquet schema so the
rest of the application can continue to work unchanged when the live weather
endpoint is rate-limited or returns unusable data.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd


BACKUP_PROFILE_PATH = Path(__file__).resolve().parents[3] / "data_backup" / "weather_profile.json"
_LOCAL_TZ = ZoneInfo("Europe/Helsinki")
_PROFILE_HOURS = 72
_PROFILE_VERSION = 3


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def generate_demo_weather_profile(hours: int = _PROFILE_HOURS) -> dict:
    """Return a relative-hour weather profile suitable for fallback use."""
    profile_hours: list[dict[str, float | int]] = []

    for hour_offset in range(hours):
        diurnal = math.sin(((hour_offset % 24) - 5) / 24 * math.tau)
        synoptic = math.sin(hour_offset / 8.0) + 0.55 * math.cos(hour_offset / 19.0)

        # Demo event: winds ramp up around +30h, peak by +40h, then
        # gradually calm so FPV threat appears again later in the timeline.
        high_wind_boost = 0.0
        if 30 <= hour_offset <= 40:
            phase = (hour_offset - 30.0) / 10.0
            high_wind_boost = 6.0 + 1.8 * math.sin(math.pi * phase)
        elif hour_offset > 40:
            decay = min(1.0, (hour_offset - 40.0) / 14.0)
            high_wind_boost = 6.0 * ((1.0 - decay) ** 2)

        wind_speed = _clamp(5.2 + 1.7 * synoptic + 0.9 * diurnal + high_wind_boost, 1.8, 19.5)
        wind_dir = (228 + 26 * math.sin(hour_offset / 6.5) + 12 * math.cos(hour_offset / 17.0)) % 360
        wind_gust = _clamp(
            wind_speed + 1.5 + 1.1 * (0.5 + 0.5 * math.sin(hour_offset / 4.2)) + 0.45 * high_wind_boost,
            wind_speed + 0.8,
            24.0,
        )
        wind_speed_120m = _clamp(wind_speed + 1.6 + 0.8 * math.cos(hour_offset / 7.5) + 0.35 * high_wind_boost, 2.4, 22.0)
        wind_dir_120m = (wind_dir + 8 + 5 * math.sin(hour_offset / 9.0)) % 360

        temperature = _clamp(8.5 + 6.3 * diurnal + 1.8 * math.cos(hour_offset / 20.0), -3.0, 21.0)
        apparent_temperature = temperature - 0.35 * wind_speed
        humidity = _clamp(77 - 14 * diurnal + 6 * math.sin(hour_offset / 15.0), 46, 97)
        dewpoint = temperature - _clamp((100 - humidity) / 5.3, 1.5, 9.0)

        cloudcover = _clamp(54 + 24 * math.sin((hour_offset - 2) / 10.0) + 16 * math.cos(hour_offset / 21.0), 10, 98)
        cloud_low = _clamp(cloudcover * 0.42 + 8 * math.sin(hour_offset / 5.0), 0, 100)
        cloud_mid = _clamp(cloudcover * 0.33 + 7 * math.cos(hour_offset / 7.0), 0, 100)
        cloud_high = _clamp(cloudcover * 0.25 + 6 * math.sin(hour_offset / 11.0), 0, 100)

        precipitation = max(0.0, round(0.55 * math.sin((hour_offset - 7) / 4.6) + 0.18 * math.cos(hour_offset / 2.9), 2))
        rain = precipitation if temperature > 1.0 else 0.0
        snowfall = precipitation * 0.7 if temperature <= 1.0 else 0.0
        snow_depth = max(0.0, 0.04 + 0.015 * math.cos(hour_offset / 18.0) + snowfall * 0.02)

        visibility = _clamp(28000 - cloudcover * 115 - precipitation * 6500, 3500, 30000)
        pressure = _clamp(1009 + 6 * math.cos(hour_offset / 14.0) - 2.5 * math.sin(hour_offset / 9.0), 995, 1028)
        freezing_level = _clamp(900 + temperature * 115, 0, 3200)
        soil_temp = _clamp(temperature - 1.8 + 0.6 * math.sin(hour_offset / 13.0), -2.0, 18.0)
        soil_moisture = _clamp(0.29 + precipitation * 0.012 + 0.02 * math.sin(hour_offset / 16.0), 0.18, 0.52)
        shortwave = max(0.0, (720 * max(0.0, diurnal)) * (1 - cloudcover / 140))

        weather_code = 3 if cloudcover >= 70 else 2 if cloudcover >= 45 else 1
        if precipitation >= 1.2:
            weather_code = 63 if temperature > 1.0 else 73
        elif precipitation >= 0.2:
            weather_code = 61 if temperature > 1.0 else 71

        profile_hours.append({
            "hour_offset": hour_offset,
            "wind_speed_ms": round(wind_speed, 2),
            "wind_dir_deg": round(wind_dir, 1),
            "wind_gust_ms": round(wind_gust, 2),
            "wind_speed_120m_ms": round(wind_speed_120m, 2),
            "wind_dir_120m_deg": round(wind_dir_120m, 1),
            "precipitation_mm": round(precipitation, 2),
            "rain_mm": round(rain, 2),
            "snowfall_cm": round(snowfall, 2),
            "snow_depth_m": round(snow_depth, 3),
            "soil_moisture_m3m3": round(soil_moisture, 3),
            "visibility_m": round(visibility, 0),
            "cloudcover_pct": round(cloudcover, 0),
            "cloudcover_low_pct": round(cloud_low, 0),
            "cloudcover_mid_pct": round(cloud_mid, 0),
            "cloudcover_high_pct": round(cloud_high, 0),
            "weather_code": weather_code,
            "temperature_c": round(temperature, 1),
            "apparent_temperature_c": round(apparent_temperature, 1),
            "humidity_pct": round(humidity, 0),
            "dewpoint_c": round(dewpoint, 1),
            "pressure_hpa": round(pressure, 1),
            "freezing_level_m": round(freezing_level, 0),
            "soil_temperature_c": round(soil_temp, 1),
            "shortwave_radiation_wm2": round(shortwave, 0),
        })

    return {
        "profile_version": _PROFILE_VERSION,
        "timezone": "Europe/Helsinki",
        "hours": profile_hours,
    }


def load_or_create_backup_profile(path: Path = BACKUP_PROFILE_PATH) -> dict:
    """Load the persisted fallback profile or create it on first use."""
    if path.exists():
        with open(path, "r", encoding="utf-8") as handle:
            loaded = json.load(handle)
        if (
            isinstance(loaded, dict)
            and int(loaded.get("profile_version", 0)) == _PROFILE_VERSION
            and isinstance(loaded.get("hours"), list)
            and len(loaded["hours"]) > 0
        ):
            return loaded

    profile = generate_demo_weather_profile()
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(profile, handle, indent=2)
    return profile


def build_backup_weather_dataframe(points: list[tuple[float, float]]) -> pd.DataFrame:
    """Expand the fallback profile into the same row-per-point-per-hour schema."""
    profile = load_or_create_backup_profile()
    hours = profile.get("hours") or []
    if not isinstance(hours, list) or not hours:
        raise ValueError("backup weather profile is empty or invalid")

    start_time = datetime.now(_LOCAL_TZ).replace(minute=0, second=0, microsecond=0)
    rows: list[dict] = []
    for point_idx, (pt_lat, pt_lon) in enumerate(points):
        point_speed_factor = 1.0 + (((point_idx % 5) - 2) * 0.035)
        point_dir_offset = ((point_idx * 11) % 19) - 9
        point_temp_offset = ((point_idx % 4) - 1.5) * 0.4
        point_cloud_offset = ((point_idx * 7) % 13) - 6

        for item in hours:
            hour_offset = int(item.get("hour_offset", 0))
            valid_time = (start_time + timedelta(hours=hour_offset)).isoformat()
            wind_speed = _clamp(float(item["wind_speed_ms"]) * point_speed_factor, 1.0, 22.0)
            wind_gust = _clamp(float(item["wind_gust_ms"]) * point_speed_factor, wind_speed + 0.5, 26.0)
            wind_speed_120m = _clamp(float(item["wind_speed_120m_ms"]) * point_speed_factor, 1.5, 24.0)

            # Keep the event deterministic: 30–40h is a hostile FPV period,
            # then winds calm so threat can return.
            if 30 <= hour_offset <= 40:
                event_floor = max(15.2, 15.8 + 1.2 * math.sin((hour_offset - 30) / 10.0))
                wind_speed = max(wind_speed, event_floor)
                wind_gust = max(wind_gust, wind_speed + 2.0)
                wind_speed_120m = max(wind_speed_120m, wind_speed + 1.0)
            elif hour_offset > 40:
                calm_cap = 11.4 + 0.8 * math.sin((hour_offset - 40) / 6.0)
                wind_speed = min(wind_speed, calm_cap)
                wind_gust = min(max(wind_gust, wind_speed + 0.8), wind_speed + 4.0)
                wind_speed_120m = min(max(wind_speed_120m, wind_speed + 0.6), wind_speed + 3.0)

            temperature = _clamp(float(item["temperature_c"]) + point_temp_offset, -6.0, 24.0)
            apparent_temperature = _clamp(float(item["apparent_temperature_c"]) + point_temp_offset - 0.15, -8.0, 23.0)
            cloudcover = _clamp(float(item["cloudcover_pct"]) + point_cloud_offset, 0.0, 100.0)
            cloud_low = _clamp(float(item["cloudcover_low_pct"]) + point_cloud_offset, 0.0, 100.0)
            cloud_mid = _clamp(float(item["cloudcover_mid_pct"]) + point_cloud_offset, 0.0, 100.0)
            cloud_high = _clamp(float(item["cloudcover_high_pct"]) + point_cloud_offset, 0.0, 100.0)
            visibility = _clamp(float(item["visibility_m"]) - abs(point_cloud_offset) * 140, 3000.0, 30000.0)

            rows.append({
                "lon": pt_lon,
                "lat": pt_lat,
                "valid_time": valid_time,
                "wind_speed_ms": wind_speed,
                "wind_dir_deg": (float(item["wind_dir_deg"]) + point_dir_offset) % 360,
                "wind_gust_ms": wind_gust,
                "wind_speed_120m_ms": wind_speed_120m,
                "wind_dir_120m_deg": (float(item["wind_dir_120m_deg"]) + point_dir_offset + 4) % 360,
                "precipitation_mm": float(item["precipitation_mm"]),
                "rain_mm": float(item["rain_mm"]),
                "snowfall_cm": float(item["snowfall_cm"]),
                "snow_depth_m": float(item["snow_depth_m"]),
                "soil_moisture_m3m3": float(item["soil_moisture_m3m3"]),
                "visibility_m": visibility,
                "cloudcover_pct": cloudcover,
                "cloudcover_low_pct": cloud_low,
                "cloudcover_mid_pct": cloud_mid,
                "cloudcover_high_pct": cloud_high,
                "weather_code": int(item["weather_code"]),
                "temperature_c": temperature,
                "apparent_temperature_c": apparent_temperature,
                "humidity_pct": float(item["humidity_pct"]),
                "dewpoint_c": float(item["dewpoint_c"]) + point_temp_offset,
                "pressure_hpa": float(item["pressure_hpa"]),
                "freezing_level_m": float(item["freezing_level_m"]),
                "soil_temperature_c": float(item["soil_temperature_c"]),
                "shortwave_radiation_wm2": float(item["shortwave_radiation_wm2"]),
            })

    df = pd.DataFrame(rows)
    float_cols = [c for c in df.columns if c not in ("lon", "lat", "valid_time", "weather_code")]
    df[float_cols] = df[float_cols].astype("float32")
    return df