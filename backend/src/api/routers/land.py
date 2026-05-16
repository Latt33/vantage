"""Land endpoints — backed by `src/service/nls/land.py`."""

from fastapi import APIRouter
from fastapi.responses import FileResponse

from src.api._responses import serve_layer_file

router = APIRouter(prefix="/api/aoi/{aoi_id}/land", tags=["land"])


@router.get("/cover", response_class=FileResponse)
async def get_land_cover(aoi_id: str) -> FileResponse:
    """Land cover polygons — forest / open / built (GeoJSON FeatureCollection)."""
    return serve_layer_file(aoi_id, "land", "cover.geojson")


@router.get("/cover.png", response_class=FileResponse)
async def get_land_cover_image(aoi_id: str) -> FileResponse:
    """Rasterized land cover overlay for fast map rendering."""
    return serve_layer_file(aoi_id, "land", "cover.png")


@router.get("/forest", response_class=FileResponse)
async def get_forest_cover(aoi_id: str) -> FileResponse:
    """Forest-only polygons derived from the land cover collection."""
    return serve_layer_file(aoi_id, "land", "forest.geojson")


@router.get("/forest.png", response_class=FileResponse)
async def get_forest_cover_image(aoi_id: str) -> FileResponse:
    """Rasterized forest-density overlay for fast map rendering."""
    return serve_layer_file(aoi_id, "land", "forest.png")


@router.get("/buildings", response_class=FileResponse)
async def get_buildings(aoi_id: str) -> FileResponse:
    """Building footprints (GeoJSON FeatureCollection)."""
    return serve_layer_file(aoi_id, "land", "buildings.geojson")
