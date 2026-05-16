"""MCOO endpoints — backed by `src/service/analysis/mcoo.py`."""

from fastapi import APIRouter
from fastapi.responses import FileResponse

from src.api._responses import serve_layer_file

router = APIRouter(prefix="/api/aoi/{aoi_id}/mcoo", tags=["mcoo"])


@router.get("/trafficability", response_class=FileResponse)
async def get_trafficability(aoi_id: str) -> FileResponse:
    """Modified Combined Obstacle Overlay zones (GeoJSON FeatureCollection)."""
    return serve_layer_file(aoi_id, "mcoo", "trafficability.geojson")
