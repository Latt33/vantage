"""Traffic-camera endpoints — backed by `src/service/digitraffic/weathercam.py`."""

from fastapi import APIRouter
from fastapi.responses import FileResponse

from src.api._responses import serve_layer_file

router = APIRouter(prefix="/api/aoi/{aoi_id}/traffic_cameras", tags=["traffic_cameras"])


@router.get("/stations", response_class=FileResponse)
async def get_camera_stations(aoi_id: str) -> FileResponse:
    """Fintraffic road weather cameras within the AOI (GeoJSON FeatureCollection)."""
    return serve_layer_file(aoi_id, "traffic_cameras", "stations.geojson")
