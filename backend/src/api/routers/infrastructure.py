"""Infrastructure endpoints — backed by `src/service/osm/infra.py`.

All sub-layers are derived from a single infra.osm file by filtering on OSM tags.
tag_filter uses AND-match; exclude_tags uses OR-exclusion (see _responses.py).
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from src.api._responses import serve_osm_as_geojson

router = APIRouter(prefix="/api/aoi/{aoi_id}/infrastructure", tags=["infrastructure"])


@router.get("/roads", response_class=JSONResponse)
async def get_roads(aoi_id: str) -> JSONResponse:
    """Road network (GeoJSON LineStrings), bridges excluded."""
    return serve_osm_as_geojson(
        aoi_id, "infrastructure", "infra.osm",
        tag_filter={"highway": None},
        exclude_tags={"bridge": "yes"},
    )


@router.get("/bridges", response_class=JSONResponse)
async def get_bridges(aoi_id: str) -> JSONResponse:
    """Bridge ways (GeoJSON LineStrings)."""
    return serve_osm_as_geojson(
        aoi_id, "infrastructure", "infra.osm",
        tag_filter={"bridge": "yes"},
    )


@router.get("/fuel", response_class=JSONResponse)
async def get_fuel(aoi_id: str) -> JSONResponse:
    """Fuel stations (GeoJSON Points)."""
    return serve_osm_as_geojson(
        aoi_id, "infrastructure", "infra.osm",
        tag_filter={"amenity": "fuel"},
    )


@router.get("/power", response_class=JSONResponse)
async def get_power(aoi_id: str) -> JSONResponse:
    """Power infrastructure — lines and nodes (GeoJSON)."""
    return serve_osm_as_geojson(
        aoi_id, "infrastructure", "infra.osm",
        tag_filter={"power": None},
    )


@router.get("/healthcare", response_class=JSONResponse)
async def get_healthcare(aoi_id: str) -> JSONResponse:
    """Healthcare facilities — hospitals, clinics, doctors (GeoJSON)."""
    return serve_osm_as_geojson(
        aoi_id, "infrastructure", "infra.osm",
        tag_filter={"amenity": ["hospital", "clinic", "doctors"]},
    )


@router.get("/water_works", response_class=JSONResponse)
async def get_water_works(aoi_id: str) -> JSONResponse:
    """Water works installations (GeoJSON)."""
    return serve_osm_as_geojson(
        aoi_id, "infrastructure", "infra.osm",
        tag_filter={"man_made": "water_works"},
    )
