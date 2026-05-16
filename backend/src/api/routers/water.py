"""Water endpoints — backed by `src/service/nls/water.py`."""

from fastapi import APIRouter
from fastapi.responses import FileResponse

from src.api._responses import serve_layer_file

router = APIRouter(prefix="/api/aoi/{aoi_id}/water", tags=["water"])


@router.get("/bodies", response_class=FileResponse)
async def get_water_bodies(aoi_id: str) -> FileResponse:
    """Lakes and ponds (GeoJSON FeatureCollection)."""
    return serve_layer_file(aoi_id, "water", "bodies.geojson")


@router.get("/courses", response_class=FileResponse)
async def get_water_courses(aoi_id: str) -> FileResponse:
    """Rivers and streams (GeoJSON FeatureCollection)."""
    return serve_layer_file(aoi_id, "water", "courses.geojson")
