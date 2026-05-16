"""Generic layer manifest + raw-file access.

Prefer the typed per-feature routers (`weather`, `water`, `land`, …) from the
frontend — they are stable, documented contracts. These generic endpoints exist
for debugging, ad-hoc inspection, and any new file a service writes before its
typed router is added.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from src.api._responses import ensure_aoi, serve_layer_file
from src.jobs.orchestrator import STAGE_NAMES
from src.service._shared.storage import get_category_meta, is_stale

router = APIRouter(prefix="/api/aoi/{aoi_id}/layers", tags=["layers"])


@router.get("")
async def layers_manifest(aoi_id: str) -> dict:
    """Manifest of all categories with metadata but no data payloads.

    Use to populate the explainability panel (source, confidence,
    feature counts, staleness).
    """
    ensure_aoi(aoi_id)

    categories = []
    for stage_name in STAGE_NAMES:
        meta = get_category_meta(aoi_id, stage_name)
        entry: dict = {"name": stage_name, "available": meta is not None}
        if meta:
            entry.update({
                "stale":          is_stale(aoi_id, stage_name),
                "source":         meta.get("source"),
                "confidence":     meta.get("confidence"),
                "feature_counts": meta.get("feature_counts"),
                "fetched_at":     meta.get("fetched_at"),
            })
        categories.append(entry)

    return {"aoi_id": aoi_id, "categories": categories}


@router.get("/{category}/{filename}", response_class=FileResponse)
async def layer_file(aoi_id: str, category: str, filename: str) -> FileResponse:
    """Serve a single data file for a category by raw filename."""
    if category not in STAGE_NAMES:
        raise HTTPException(status_code=404, detail=f"Unknown category '{category}'")
    return serve_layer_file(aoi_id, category, filename)
