"""FastAPI entrypoint — routing only, no business logic.

All data fetching goes through src/jobs/orchestrator.py.
Layer data is stored in Redis and served per-layer to keep responses small.
"""

from contextlib import asynccontextmanager

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, model_validator

from src.jobs.orchestrator import STAGE_NAMES, run_job
from src.jobs.store import create_job, get_job, get_layer, new_job_id
from src.service._shared.bbox import BBox
from src.service._shared.client import close_client


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await close_client()


app = FastAPI(title="AI2PB backend", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten in production
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request model
# ---------------------------------------------------------------------------

class PrepareRequest(BaseModel):
    min_lon: float
    min_lat: float
    max_lon: float
    max_lat: float

    @model_validator(mode="after")
    def validate_bbox(self) -> "PrepareRequest":
        BBox(self.min_lon, self.min_lat, self.max_lon, self.max_lat).validate()
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
    """Return job status and per-stage progress.

    Poll this endpoint until status == 'completed'. Individual stages
    may reach 'done' before the overall job completes — the frontend can
    start fetching those layers immediately without waiting for all stages.

    Response shape:
        {
            "status": "pending | running | completed | error",
            "stages": {
                "terrain":        "pending | running | done | error",
                "weather":        "pending | running | done | error",
                "infrastructure": "pending | running | done | error"
            },
            "created_at": "<ISO timestamp>"
        }
    """
    job = await get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/api/layers/{job_id}")
async def layers_manifest(job_id: str) -> dict:
    """Return a manifest of available layers for a job.

    Does NOT return GeoJSON payloads — fetch individual layers via
    GET /api/layers/{job_id}/{layer_name}.

    Response shape:
        {
            "job_id": "...",
            "layers": [
                {
                    "name": "terrain",
                    "status": "done",
                    "source": "NLS Finland",
                    "confidence": "high",
                    "feature_count": 42
                },
                ...
            ]
        }
    """
    job = await get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    layer_summaries = []
    for stage_name in STAGE_NAMES:
        stage_status = job["stages"].get(stage_name, "pending")
        summary: dict = {"name": stage_name, "status": stage_status}

        if stage_status in ("done", "error"):
            layer = await get_layer(job_id, stage_name)
            if layer:
                summary["source"] = layer.get("source", "unknown")
                summary["confidence"] = layer.get("confidence", "unknown")
                summary["feature_count"] = len(layer.get("features", []))
                if layer.get("status") == "error":
                    summary["error"] = layer.get("error")

        layer_summaries.append(summary)

    return {"job_id": job_id, "layers": layer_summaries}


@app.get("/api/layers/{job_id}/{layer_name}")
async def layer_data(job_id: str, layer_name: str) -> dict:
    """Return the GeoJSON FeatureCollection for a single layer.

    Available as soon as the corresponding stage status is 'done' or 'error'.
    The frontend should not wait for all stages before fetching ready layers.
    """
    job = await get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    if layer_name not in STAGE_NAMES:
        raise HTTPException(status_code=404, detail=f"Unknown layer '{layer_name}'")

    stage_status = job["stages"].get(layer_name, "pending")
    if stage_status in ("pending", "running"):
        raise HTTPException(status_code=202, detail=f"Layer '{layer_name}' not ready yet (status: {stage_status})")

    layer = await get_layer(job_id, layer_name)
    if layer is None:
        raise HTTPException(status_code=404, detail=f"Layer '{layer_name}' data not found in store")

    return layer
