"""Redis-backed job store.

Metadata and layer data are stored under separate keys so that updating
job status never requires re-serialising large GeoJSON payloads.

Keys:
    job:{job_id}               → { status, stages, created_at }
    job:{job_id}:layer:{name}  → GeoJSON FeatureCollection (one key per layer)

Both keys share the same TTL so they expire together.
"""

import json
import os
import uuid
from datetime import datetime, timezone

import redis.asyncio as aioredis

_REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
_JOB_TTL = 60 * 60 * 2  # 2 hours

_redis: aioredis.Redis = aioredis.from_url(_REDIS_URL, decode_responses=True)


def new_job_id() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Job metadata
# ---------------------------------------------------------------------------

async def create_job(job_id: str, stage_names: list[str]) -> None:
    job = {
        "status": "pending",
        "stages": {name: "pending" for name in stage_names},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await _redis.set(f"job:{job_id}", json.dumps(job), ex=_JOB_TTL)


async def get_job(job_id: str) -> dict | None:
    raw = await _redis.get(f"job:{job_id}")
    return json.loads(raw) if raw else None


async def set_job_status(job_id: str, status: str) -> None:
    job = await get_job(job_id)
    if job is None:
        return
    job["status"] = status
    await _redis.set(f"job:{job_id}", json.dumps(job), ex=_JOB_TTL)


async def set_stage_status(job_id: str, stage: str, status: str) -> None:
    job = await get_job(job_id)
    if job is None:
        return
    job["stages"][stage] = status
    await _redis.set(f"job:{job_id}", json.dumps(job), ex=_JOB_TTL)


# ---------------------------------------------------------------------------
# Layer data (stored separately from job metadata)
# ---------------------------------------------------------------------------

async def store_layer(job_id: str, layer_name: str, geojson: dict) -> None:
    await _redis.set(f"job:{job_id}:layer:{layer_name}", json.dumps(geojson), ex=_JOB_TTL)


async def get_layer(job_id: str, layer_name: str) -> dict | None:
    raw = await _redis.get(f"job:{job_id}:layer:{layer_name}")
    return json.loads(raw) if raw else None
