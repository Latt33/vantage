"""Traffic-camera endpoints — backed by `src/service/digitraffic/weathercam.py`."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from fastapi.responses import JSONResponse

from src.api._responses import serve_layer_file
from src.service.digitraffic.weathercam import fetch_weathercam_station

router = APIRouter(prefix="/api/aoi/{aoi_id}/traffic_cameras", tags=["traffic_cameras"])


@router.get("/stations", response_class=FileResponse)
async def get_camera_stations(aoi_id: str) -> FileResponse:
    """Fintraffic road weather cameras within the AOI (GeoJSON FeatureCollection)."""
    return serve_layer_file(aoi_id, "traffic_cameras", "stations.geojson")


@router.get("/stations/{station_id}")
async def get_camera_station(aoi_id: str, station_id: str) -> JSONResponse:
    """Latest image metadata for a single road weather camera station."""
    payload = await fetch_weathercam_station(aoi_id, station_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Camera station not found")
    return JSONResponse(content=payload)
