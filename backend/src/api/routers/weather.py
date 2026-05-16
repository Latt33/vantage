"""Weather endpoints — backed by `src/service/ecmwf/weather.py`."""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from src.api._responses import serve_parquet_as_geojson

router = APIRouter(prefix="/api/aoi/{aoi_id}/weather", tags=["weather"])

_WEATHER_COLS = [
    "valid_time",
    "wind_speed_ms", "wind_dir_deg", "wind_gust_ms",
    "wind_speed_120m_ms", "wind_dir_120m_deg",
    "precipitation_mm", "rain_mm", "snowfall_cm", "snow_depth_m",
    "soil_moisture_m3m3",
    "visibility_m", "weather_code",
    "cloudcover_pct", "cloudcover_low_pct", "cloudcover_mid_pct", "cloudcover_high_pct",
    "temperature_c", "apparent_temperature_c", "humidity_pct",
    "dewpoint_c", "pressure_hpa", "freezing_level_m",
    "soil_temperature_c", "shortwave_radiation_wm2",
]


@router.get("/forecast", response_class=JSONResponse)
async def get_weather_forecast(aoi_id: str) -> JSONResponse:
    """ECMWF IFS hourly forecast as GeoJSON (one Point per grid-point × time-step)."""
    return serve_parquet_as_geojson(aoi_id, "weather", "forecast.parquet", _WEATHER_COLS)
