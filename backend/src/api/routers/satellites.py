"""Satellite-pass and trajectory endpoints."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from src.api._responses import serve_layer_file
from src.service._shared.bbox import BBox
from src.service._shared.storage import category_file, ensure_dir, get_aoi_meta, read_json, write_json
from src.service.celestrak.trajectories import compute_trajectories

router = APIRouter(prefix="/api/aoi/{aoi_id}/satellites", tags=["satellites"])

_TRAJECTORIES_TTL = timedelta(hours=24)


@router.get("/passes", response_class=FileResponse)
async def get_satellite_passes(aoi_id: str) -> FileResponse:
    """Upcoming reconnaissance-satellite passes over the AOI (GeoJSON)."""
    return serve_layer_file(aoi_id, "satellites", "passes.geojson")


@router.get("/trajectories")
async def get_satellite_trajectories(aoi_id: str) -> dict:
    """72-hour SGP4 ground tracks for satellites within 500 km of the AOI.

    Result is cached to disk for 24 hours so repeated requests (e.g. page
    reloads) do not hit N2YO on every call.  The cache is stored at:
        data/{aoi_id}/satellites/trajectories.geojson
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

    traj_path = category_file(aoi_id, "satellites", "trajectories.geojson")

    # Serve from disk if the cached file is still within the TTL.
    if traj_path.exists():
        age = datetime.now(timezone.utc) - datetime.fromtimestamp(
            traj_path.stat().st_mtime, tz=timezone.utc
        )
        if age < _TRAJECTORIES_TTL:
            cached = read_json(traj_path)
            if cached is not None:
                return cached

    fc = await compute_trajectories(bbox)
    ensure_dir(traj_path.parent)
    write_json(traj_path, fc)
    return fc
