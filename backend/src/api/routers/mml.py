"""MML debug/inspection endpoints.

Not used by the operator flow — surfaced so a developer can sanity-check the
NLS OGC Features catalogue when adding a new collection to a service module.
"""

from fastapi import APIRouter

from src.service.mml_data import fetch_mml_collections

router = APIRouter(prefix="/terrain/mml", tags=["debug"])


@router.get("/collections")
async def get_mml_collections() -> dict:
    """List available NLS topographic data collections."""
    return await fetch_mml_collections()
