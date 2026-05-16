"""DEM endpoints — backed by `src/service/nls/dem.py`."""

from fastapi import APIRouter
from fastapi.responses import FileResponse, JSONResponse

from src.api._responses import serve_layer_file, serve_parquet_as_geojson

router = APIRouter(prefix="/api/aoi/{aoi_id}/dem", tags=["dem"])


@router.get("/elevation", response_class=JSONResponse)
async def get_elevation(aoi_id: str) -> JSONResponse:
    """DEM grid as GeoJSON FeatureCollection (lon, lat, elevation_m per point)."""
    return serve_parquet_as_geojson(aoi_id, "dem", "elevation.parquet")


@router.get("/elevation.png", response_class=FileResponse)
async def get_elevation_image(aoi_id: str) -> FileResponse:
    """Croppable raster DEM overlay for map rendering."""
    return serve_layer_file(aoi_id, "dem", "elevation.png")
