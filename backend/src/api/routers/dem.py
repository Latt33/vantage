"""DEM endpoints — backed by `src/service/nls/dem.py`."""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from src.api._responses import serve_parquet_as_geojson

router = APIRouter(prefix="/api/aoi/{aoi_id}/dem", tags=["dem"])


@router.get("/elevation", response_class=JSONResponse)
async def get_elevation(aoi_id: str) -> JSONResponse:
    """DEM elevation grid as GeoJSON (WGS84 points with elevation_m property)."""
    return serve_parquet_as_geojson(aoi_id, "dem", "elevation.parquet", ["elevation_m"])
