"""Redis-backed job store — tracks fetch job state only.

Actual data lives on disk under src/data/{aoi_id}/.
Redis holds only the transient job state needed during a fetch operation.

Job shape in Redis (key: job:{job_id}):
{
    "job_id":   "uuid",
    "aoi_id":   "uuid",
    "status":   "pending | running | completed | error",
    "stages": {
        "weather":        "pending | running | done | error",
        "water":          "pending | running | done | error",
        "land":           "pending | running | done | error",
        "infrastructure": "pending | running | done | error"
    },
    "created_at": "<ISO timestamp>"
}

TTL is short — jobs are transient. Data persistence is handled by the filesystem.
"""

import json
import os
import uuid
from datetime import datetime, timezone

import redis.asyncio as aioredis

_REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
_JOB_TTL = 60 * 60  # 1 hour — jobs are transient, data lives on disk

_redis: aioredis.Redis = aioredis.from_url(_REDIS_URL, decode_responses=True)


def new_id() -> str:
    return str(uuid.uuid4())


async def create_job(job_id: str, aoi_id: str, stage_names: list[str]) -> None:
    job = {
        "job_id": job_id,
        "aoi_id": aoi_id,
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
