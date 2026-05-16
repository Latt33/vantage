"""Derived-metric endpoints.

Lazy compute pattern: the file is built on first request, then served
as a cached PNG on subsequent requests. Per-AoI asyncio locks prevent
duplicate work when concurrent clicks land before the first compute
finishes.
"""

import asyncio
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from src.api._responses import ensure_aoi
from src.service._shared.bbox import BBox
from src.service._shared.storage import category_file
from src.service.analysis.fpv_threat import build_fpv_threat
from src.service.analysis.movement_corridors import (
    build_movement_corridors_heavy,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/aoi/{aoi_id}/derived", tags=["derived"])

# One asyncio.Lock per (aoi_id, derivative_key) so concurrent requests
# don't trigger duplicate computes.
_locks: dict[tuple[str, str], asyncio.Lock] = {}


def _lock_for(aoi_id: str, key: str) -> asyncio.Lock:
    lock = _locks.get((aoi_id, key))
    if lock is None:
        lock = asyncio.Lock()
        _locks[(aoi_id, key)] = lock
    return lock


def _bbox_from_meta(meta: dict) -> BBox:
    bbox = meta.get("bbox") or {}
    try:
        return BBox(
            min_lon=float(bbox["min_lon"]),
            min_lat=float(bbox["min_lat"]),
            max_lon=float(bbox["max_lon"]),
            max_lat=float(bbox["max_lat"]),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=f"AoI bbox invalid: {exc}")


@router.get("/movement_corridors/heavy.png", response_class=FileResponse)
async def get_movement_corridors_heavy(aoi_id: str) -> FileResponse:
    """Heavy-vehicle movement-corridors raster (PNG, EPSG:4326 coverage of AoI)."""
    meta = ensure_aoi(aoi_id)
    out_path = category_file(aoi_id, "derived", "movement_corridors_heavy.png")

    if not out_path.exists():
        lock = _lock_for(aoi_id, "movement_corridors_heavy")
        async with lock:
            if not out_path.exists():
                bbox = _bbox_from_meta(meta)
                # Required upstream inputs must already be on disk; if not,
                # the compute returns a transparent placeholder and the
                # client can retry once the pipeline finishes.
                try:
                    await asyncio.to_thread(
                        build_movement_corridors_heavy, aoi_id, bbox,
                    )
                except Exception as exc:
                    logger.exception("movement_corridors compute failed: %s", exc)
                    raise HTTPException(
                        status_code=500,
                        detail=f"compute failed: {exc}",
                    )

    if not out_path.exists():
        raise HTTPException(status_code=503, detail="derived raster not ready")

    return FileResponse(out_path, media_type="image/png")


@router.get("/fpv_threat.png", response_class=FileResponse)
async def get_fpv_threat(aoi_id: str) -> FileResponse:
    """FPV-drone threat-areas raster (PNG, EPSG:4326 coverage of AoI).

    Combines forest cover with the nearest wind forecast grid point:
    dense forest or wind outside the FPV operational envelope render
    transparent; remaining cells are shaded blue, darker = lower wind =
    higher threat.
    """
    meta = ensure_aoi(aoi_id)
    out_path = category_file(aoi_id, "derived", "fpv_threat.png")

    if not out_path.exists():
        lock = _lock_for(aoi_id, "fpv_threat")
        async with lock:
            if not out_path.exists():
                bbox = _bbox_from_meta(meta)
                try:
                    await asyncio.to_thread(build_fpv_threat, aoi_id, bbox)
                except Exception as exc:
                    logger.exception("fpv_threat compute failed: %s", exc)
                    raise HTTPException(
                        status_code=500,
                        detail=f"compute failed: {exc}",
                    )

    if not out_path.exists():
        raise HTTPException(status_code=503, detail="derived raster not ready")

    return FileResponse(out_path, media_type="image/png")
