"""Weather endpoints — backed by `src/service/ecmwf/weather.py`."""

from fastapi import APIRouter
from fastapi.responses import FileResponse

from src.api._responses import serve_layer_file

router = APIRouter(prefix="/api/aoi/{aoi_id}/weather", tags=["weather"])


@router.get("/forecast", response_class=FileResponse)
async def get_weather_forecast(aoi_id: str) -> FileResponse:
    """ECMWF IFS hourly WeatherGrid for the AOI (JSON, see DATA_CONTRACTS.md)."""
    return serve_layer_file(aoi_id, "weather", "forecast.json")
