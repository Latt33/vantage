"""FastAPI entrypoint — routing only, no business logic.

AoI lifecycle:
    POST /api/aoi                              create AoI, start fetch job
    GET  /api/aoi/{aoi_id}/status              poll job progress
    GET  /api/aoi/{aoi_id}/layers              manifest (metadata, no payloads)
    GET  /api/aoi/{aoi_id}/layers/{cat}/{file} serve a data file
    POST /api/aoi/{aoi_id}/refresh/{category}  force re-fetch one category
"""
from dotenv import load_dotenv
from src.service.mml_data import fetch_mml_collections

# Load environment variables
load_dotenv()

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, model_validator

from src.jobs.orchestrator import STAGE_NAMES, run_job
from src.jobs.store import create_job, get_job, new_id
from src.service._shared.bbox import BBox
from src.service._shared.client import close_client
from src.service._shared.storage import (
    category_dir,
    category_file,
    create_aoi,
    get_aoi_meta,
    get_category_meta,
    is_stale,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await close_client()


app = FastAPI(title="AI2PB backend", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in production
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request models
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
# Helpers
# ---------------------------------------------------------------------------

def _bbox_from_request(req: PrepareRequest) -> BBox:
    return BBox(req.min_lon, req.min_lat, req.max_lon, req.max_lat)


def _bbox_dict(req: PrepareRequest) -> dict:
    return {
        "min_lon": req.min_lon, "min_lat": req.min_lat,
        "max_lon": req.max_lon, "max_lat": req.max_lat,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/aoi")
async def create_aoi_endpoint(
    req: PrepareRequest,
    background_tasks: BackgroundTasks,
) -> dict:
    """Create a new AoI, queue a fetch job, return aoi_id and job_id.

    Stale or missing categories are fetched in the background.
    Fresh categories are served immediately without any network requests.
    """
    bbox = _bbox_from_request(req)
    aoi_id = new_id()
    job_id = new_id()

    create_aoi(aoi_id, _bbox_dict(req))
    await create_job(job_id, aoi_id, STAGE_NAMES)
    background_tasks.add_task(run_job, job_id, aoi_id, bbox)

    return {"aoi_id": aoi_id, "job_id": job_id}


@app.get("/api/aoi/{aoi_id}/status")
async def aoi_status(aoi_id: str) -> dict:
    """Return the most recent fetch job status for this AoI.

    Poll until status == 'completed'. Individual stages may reach 'done'
    before the job completes — layers can be fetched as soon as their
    stage is done.

    Response:
        {
            "job_id": "...",
            "aoi_id": "...",
            "status": "pending | running | completed | error",
            "stages": {
                "weather":        "pending | running | done | error",
                "water":          "pending | running | done | error",
                "land":           "pending | running | done | error",
                "infrastructure": "pending | running | done | error"
            },
            "created_at": "..."
        }
    """
    meta = get_aoi_meta(aoi_id)
    if meta is None:
        raise HTTPException(status_code=404, detail="AoI not found")

    # Find the most recent job for this AoI.
    # For now, job_id is not indexed by aoi_id — the client should pass it
    # separately. Accept job_id as a query param for polling convenience.
    raise HTTPException(
        status_code=501,
        detail="Pass job_id via GET /api/job/{job_id}/status instead",
    )


@app.get("/api/job/{job_id}/status")
async def job_status(job_id: str) -> dict:
    """Return job status. Poll this after POST /api/aoi to track fetch progress."""
    job = await get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found or expired")
    return job


@app.get("/api/aoi/{aoi_id}/layers")
async def layers_manifest(aoi_id: str) -> dict:
    """Return a manifest of all categories with metadata but no data payloads.

    Use this to populate the explainability panel (source, confidence,
    feature counts, staleness).

    Response:
        {
            "aoi_id": "...",
            "categories": [
                {
                    "name": "weather",
                    "available": true,
                    "stale": false,
                    "source": "Open-Meteo / ECMWF IFS",
                    "confidence": "high",
                    "feature_counts": { "grid_points": 9, "time_steps": 72 },
                    "fetched_at": "..."
                },
                ...
            ]
        }
    """
    if get_aoi_meta(aoi_id) is None:
        raise HTTPException(status_code=404, detail="AoI not found")

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


@app.get("/api/aoi/{aoi_id}/layers/{category}/{filename}")
async def layer_file(aoi_id: str, category: str, filename: str) -> FileResponse:
    """Serve a single data file for a category.

    Examples:
        /api/aoi/{id}/layers/weather/forecast.json
        /api/aoi/{id}/layers/water/bodies.geojson
        /api/aoi/{id}/layers/water/courses.geojson
        /api/aoi/{id}/layers/land/cover.geojson
        /api/aoi/{id}/layers/infrastructure/roads.geojson
        /api/aoi/{id}/layers/infrastructure/bridges.geojson
    """
    if get_aoi_meta(aoi_id) is None:
        raise HTTPException(status_code=404, detail="AoI not found")

    if category not in STAGE_NAMES:
        raise HTTPException(status_code=404, detail=f"Unknown category '{category}'")

    # Guard against path traversal
    if "/" in filename or "\\" in filename or filename.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid filename")

    path: Path = category_file(aoi_id, category, filename)
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"File '{filename}' not found in category '{category}' — data may still be loading",
        )

    media_type = "application/geo+json" if filename.endswith(".geojson") else "application/json"
    return FileResponse(path, media_type=media_type)


@app.get("/terrain/mml/collections")
async def get_mml_collections() -> dict:
    """Returns the available topographic data collections from Maanmittauslaitos"""
    return await fetch_mml_collections()


@app.post("/api/aoi/{aoi_id}/refresh/{category}")
async def refresh_category(
    aoi_id: str,
    category: str,
    background_tasks: BackgroundTasks,
) -> dict:
    """Force re-fetch of a single category regardless of staleness.

    Returns a new job_id to poll for completion.
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

    # Invalidate the category meta so orchestrator treats it as stale
    meta_path = category_dir(aoi_id, category) / "meta.json"
    if meta_path.exists():
        meta_path.unlink()

    job_id = new_id()
    await create_job(job_id, aoi_id, [category])
    background_tasks.add_task(run_job, job_id, aoi_id, bbox)

    return {"job_id": job_id, "aoi_id": aoi_id, "refreshing": category}
