"""Background job polling."""

from fastapi import APIRouter, HTTPException

from src.jobs.store import get_job

router = APIRouter(prefix="/api/job", tags=["jobs"])


@router.get("/{job_id}/status")
async def job_status(job_id: str) -> dict:
    """Return job state. Poll until `status == "completed"`.

    Individual `stages` may reach `"done"` before the job completes — the
    matching typed layer endpoint can be called as soon as its stage is done.
    """
    job = await get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found or expired")
    return job
