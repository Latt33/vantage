"""Infrastructure endpoints — backed by `src/service/nls/infra.py`."""

from fastapi import APIRouter
from fastapi.responses import FileResponse

from src.api._responses import serve_layer_file, serve_osm_as_geojson

router = APIRouter(prefix="/api/aoi/{aoi_id}/infrastructure", tags=["infrastructure"])


@router.get("/roads", response_class=FileResponse)
async def get_roads(aoi_id: str) -> FileResponse:
    """Road network."""
    return serve_layer_file(aoi_id, "infrastructure", "roads.geojson")


@router.get("/rail", response_class=FileResponse)
async def get_rail(aoi_id: str) -> FileResponse:
    """Rail network from OpenStreetMap Overpass data."""
    return serve_osm_as_geojson(aoi_id, "rail", "rail.osm", tag_filter={"railway": None})
