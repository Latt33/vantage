"""Cellular-tower endpoints — backed by `src/service/opencellid/towers.py`."""

from fastapi import APIRouter
from fastapi.responses import FileResponse

from src.api._responses import serve_layer_file

router = APIRouter(prefix="/api/aoi/{aoi_id}/cellular", tags=["cellular"])


@router.get("/towers", response_class=FileResponse)
async def get_cell_towers(aoi_id: str) -> FileResponse:
    """OpenCelliD cell towers within the AoI (GeoJSON Points)."""
    return serve_layer_file(aoi_id, "cellular", "towers.geojson")
