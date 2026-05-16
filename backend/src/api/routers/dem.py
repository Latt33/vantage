"""DEM endpoints — backed by `src/service/nls/dem.py`."""

from fastapi import APIRouter
from fastapi.responses import FileResponse

from src.api._responses import serve_layer_file

router = APIRouter(prefix="/api/aoi/{aoi_id}/dem", tags=["dem"])


@router.get("/elevation", response_class=FileResponse)
async def get_elevation(aoi_id: str) -> FileResponse:
    """10 m DEM raster (GeoTIFF, EPSG:3067)."""
    return serve_layer_file(aoi_id, "dem", "elevation.tiff")
