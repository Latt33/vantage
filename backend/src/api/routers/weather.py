"""Weather endpoints — backed by `src/service/ecmwf/weather.py`."""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from src.api._responses import serve_parquet_as_geojson

router = APIRouter(prefix="/api/aoi/{aoi_id}/weather", tags=["weather"])


@router.get("/forecast", response_class=JSONResponse)
async def get_weather_forecast(aoi_id: str) -> JSONResponse:
    """ECMWF IFS 3-day hourly forecast as GeoJSON FeatureCollection.

    Each feature is a Point at a grid location with all weather variables
    for one time step in its properties (including `valid_time` ISO 8601).
    """
    return serve_parquet_as_geojson(aoi_id, "weather", "forecast.parquet")
