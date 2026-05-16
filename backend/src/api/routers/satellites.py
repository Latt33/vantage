"""Satellite-pass and trajectory endpoints."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from src.api._responses import serve_layer_file
from src.service._shared.bbox import BBox
from src.service._shared.storage import get_aoi_meta
from src.service.celestrak.trajectories import compute_trajectories

router = APIRouter(prefix="/api/aoi/{aoi_id}/satellites", tags=["satellites"])


@router.get("/passes", response_class=FileResponse)
async def get_satellite_passes(aoi_id: str) -> FileResponse:
    """Upcoming reconnaissance-satellite passes over the AOI (GeoJSON)."""
    return serve_layer_file(aoi_id, "satellites", "passes.geojson")


@router.get("/trajectories")
async def get_satellite_trajectories(aoi_id: str) -> dict:
    """24-hour SGP4 ground tracks for satellites within 100 km of the AOI.

    Fetches TLEs live from CelesTrak, propagates with SGP4, and returns a
    GeoJSON FeatureCollection with:
    - MultiLineString / LineString features per satellite (5-min ground track)
    - Point features at each 1-min overpass moment within 100 km
    """
    meta = get_aoi_meta(aoi_id)
    if meta is None:
        raise HTTPException(status_code=404, detail=f"AOI {aoi_id!r} not found")

    b = meta.get("bbox", {})
    try:
        bbox = BBox(
            min_lon=float(b["min_lon"]),
            min_lat=float(b["min_lat"]),
            max_lon=float(b["max_lon"]),
            max_lat=float(b["max_lat"]),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=f"Invalid bbox in AOI metadata: {exc}") from exc

    return await compute_trajectories(bbox)
