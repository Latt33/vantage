"""Satellite-pass endpoints — backed by `src/service/n2yo/satellite.py`."""

from fastapi import APIRouter
from fastapi.responses import FileResponse

from src.api._responses import serve_layer_file

router = APIRouter(prefix="/api/aoi/{aoi_id}/satellites", tags=["satellites"])


@router.get("/passes", response_class=FileResponse)
async def get_satellite_passes(aoi_id: str) -> FileResponse:
    """Upcoming reconnaissance-satellite passes over the AOI (GeoJSON)."""
    return serve_layer_file(aoi_id, "satellites", "passes.geojson")
