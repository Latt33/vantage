"""AOI lifecycle — create, status hint, force-refresh a single category."""

from fastapi import APIRouter, BackgroundTasks, HTTPException

from src.api.schemas import PrepareRequest
from src.jobs.orchestrator import STAGE_NAMES, run_job
from src.jobs.store import create_job, new_id
from src.service._shared.bbox import BBox
from src.service._shared.storage import (
    category_dir,
    create_aoi,
    get_aoi_meta,
)

router = APIRouter(prefix="/api/aoi", tags=["aoi"])


@router.post("")
async def create_aoi_endpoint(
    req: PrepareRequest,
    background_tasks: BackgroundTasks,
) -> dict:
    """Create a new AOI and queue a fetch job.

    Stale or missing categories are fetched in the background; fresh categories
    are served immediately without network requests. Poll the returned
    `job_id` via `GET /api/job/{job_id}/status`.
    """
    aoi_id = new_id()
    job_id = new_id()

    create_aoi(aoi_id, req.to_dict())
    try:
        await create_job(job_id, aoi_id, STAGE_NAMES)
    except Exception:
        raise HTTPException(status_code=503, detail="Job store unavailable (Redis)")
    background_tasks.add_task(run_job, job_id, aoi_id, req.to_bbox())

    return {"aoi_id": aoi_id, "job_id": job_id}


@router.get("/{aoi_id}/status")
async def aoi_status(aoi_id: str) -> dict:
    """Placeholder — there is no AOI-indexed job lookup yet.

    Use the `job_id` returned by `POST /api/aoi` with
    `GET /api/job/{job_id}/status`.
    """
    if get_aoi_meta(aoi_id) is None:
        raise HTTPException(status_code=404, detail="AoI not found")
    raise HTTPException(
        status_code=501,
        detail="Pass job_id via GET /api/job/{job_id}/status instead",
    )


@router.post("/{aoi_id}/refresh/{category}")
async def refresh_category(
    aoi_id: str,
    category: str,
    background_tasks: BackgroundTasks,
) -> dict:
    """Force re-fetch of a single category regardless of staleness.

    Returns a new `job_id` to poll for completion.
    """
    meta = get_aoi_meta(aoi_id)
    if meta is None:
        raise HTTPException(status_code=404, detail="AoI not found")

    if category not in STAGE_NAMES:
        raise HTTPException(status_code=404, detail=f"Unknown category '{category}'")

    bbox_data = meta["bbox"]
    bbox = BBox(
        bbox_data["min_lon"], bbox_data["min_lat"],
        bbox_data["max_lon"], bbox_data["max_lat"],
    )

    # Invalidate the category meta so the orchestrator treats it as stale
    meta_path = category_dir(aoi_id, category) / "meta.json"
    if meta_path.exists():
        meta_path.unlink()

    job_id = new_id()
    try:
        await create_job(job_id, aoi_id, [category])
    except Exception:
        raise HTTPException(status_code=503, detail="Job store unavailable (Redis)")
    background_tasks.add_task(run_job, job_id, aoi_id, bbox)

    return {"job_id": job_id, "aoi_id": aoi_id, "refreshing": category}
