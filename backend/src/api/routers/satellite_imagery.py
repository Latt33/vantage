"""Satellite imagery endpoints — backed by `src/service/maptiler/satellite_imagery.py`."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from src.api._responses import ensure_aoi
from src.service._shared.storage import category_file, read_json

router = APIRouter(prefix="/api/aoi/{aoi_id}/satellite_imagery", tags=["satellite_imagery"])


@router.get("/overlay", response_class=JSONResponse)
async def get_satellite_overlay(aoi_id: str) -> JSONResponse:
    """MapTiler satellite raster overlay metadata for the AOI."""
    ensure_aoi(aoi_id)
    payload = read_json(category_file(aoi_id, "satellite_imagery", "overlay.json"))
    if payload is None:
        raise HTTPException(status_code=404, detail="Satellite imagery overlay not found")
    return JSONResponse(content=payload)