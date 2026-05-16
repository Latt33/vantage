"""FastAPI entrypoint.

This file only routes requests. No business logic lives here.
All data fetching goes through the orchestrator in src/jobs/.
"""

from fastapi import BackgroundTasks, FastAPI, HTTPException
from pydantic import BaseModel, model_validator

from src.jobs.orchestrator import STAGE_NAMES, run_job
from src.jobs.store import create_job, get_job, new_job_id
from src.service._shared.bbox import BBox

app = FastAPI(title="AI2PB backend", version="0.1.0")


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class PrepareRequest(BaseModel):
    min_lon: float
    min_lat: float
    max_lon: float
    max_lat: float

    @model_validator(mode="after")
    def validate_bbox(self) -> "PrepareRequest":
        bbox = BBox(self.min_lon, self.min_lat, self.max_lon, self.max_lat)
        bbox.validate()
        return self


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/prepare")
async def prepare(req: PrepareRequest, background_tasks: BackgroundTasks) -> dict:
    """Validate a bounding box, create a job, and kick off background processing."""
    bbox = BBox(req.min_lon, req.min_lat, req.max_lon, req.max_lat)
    job_id = new_job_id()
    await create_job(job_id, STAGE_NAMES)
    background_tasks.add_task(run_job, job_id, bbox)
    return {"job_id": job_id}


@app.get("/api/status/{job_id}")
async def status(job_id: str) -> dict:
    """Return the current status and per-stage progress for a job."""
    job = await get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/api/layers/{job_id}")
async def layers(job_id: str) -> dict:
    """Return the assembled GeoJSON layers once a job is completed."""
    job = await get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] != "completed":
        raise HTTPException(status_code=202, detail=f"Job status: {job['status']}")
    return job["results"]
