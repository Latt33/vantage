"""Infrastructure endpoints — backed by `src/service/osm/infra.py`.

All sub-layers are filtered on-the-fly from a single `infra.osm` file.
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from src.api._responses import serve_osm_as_geojson

router = APIRouter(prefix="/api/aoi/{aoi_id}/infrastructure", tags=["infrastructure"])

_FILE = "infra.osm"


@router.get("/roads", response_class=JSONResponse)
async def get_roads(aoi_id: str) -> JSONResponse:
    """Road network (excludes bridges)."""
    return serve_osm_as_geojson(
        aoi_id, "infrastructure", _FILE,
        tag_filter={"highway": None},
        exclude_tags={"bridge": "yes"},
    )


@router.get("/bridges", response_class=JSONResponse)
async def get_bridges(aoi_id: str) -> JSONResponse:
    """Bridges."""
    return serve_osm_as_geojson(
        aoi_id, "infrastructure", _FILE,
        tag_filter={"bridge": "yes"},
    )


@router.get("/fuel", response_class=JSONResponse)
async def get_fuel(aoi_id: str) -> JSONResponse:
    """Fuel stations."""
    return serve_osm_as_geojson(
        aoi_id, "infrastructure", _FILE,
        tag_filter={"amenity": "fuel"},
    )


@router.get("/power", response_class=JSONResponse)
async def get_power(aoi_id: str) -> JSONResponse:
    """Power infrastructure (lines, substations, generators)."""
    return serve_osm_as_geojson(
        aoi_id, "infrastructure", _FILE,
        tag_filter={"power": None},
    )


@router.get("/healthcare", response_class=JSONResponse)
async def get_healthcare(aoi_id: str) -> JSONResponse:
    """Healthcare facilities (hospitals, clinics, doctors)."""
    return serve_osm_as_geojson(
        aoi_id, "infrastructure", _FILE,
        tag_filter={"amenity": ["hospital", "clinic", "doctors"]},
    )
