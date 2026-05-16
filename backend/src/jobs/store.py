"""Redis-backed job store.

Job state is stored as a JSON string under the key `job:{job_id}`.
TTL is set to 2 hours so stale jobs are cleaned up automatically.

Shape of a job dict:
{
    "status": "pending" | "running" | "completed" | "error",
    "stages": {
        "<stage_name>": "pending" | "running" | "done" | "error"
    },
    "results": {
        "<stage_name>": <GeoJSON FeatureCollection>
    },
    "error": "<message>"   # only present when status == "error"
}
"""

import json
import os
import uuid

import redis.asyncio as aioredis

_REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
_JOB_TTL_SECONDS = 60 * 60 * 2  # 2 hours

# Module-level client — reused across requests
_redis: aioredis.Redis = aioredis.from_url(_REDIS_URL, decode_responses=True)


def new_job_id() -> str:
    return str(uuid.uuid4())


async def create_job(job_id: str, stage_names: list[str]) -> None:
    """Initialise a job entry in Redis with all stages set to 'pending'."""
    job = {
        "status": "pending",
        "stages": {name: "pending" for name in stage_names},
        "results": {},
    }
    await _redis.set(f"job:{job_id}", json.dumps(job), ex=_JOB_TTL_SECONDS)


async def get_job(job_id: str) -> dict | None:
    raw = await _redis.get(f"job:{job_id}")
    if raw is None:
        return None
    return json.loads(raw)


async def update_job(job_id: str, **kwargs) -> None:
    """Merge kwargs into the top-level job dict and write back to Redis.

    Common usage:
        await update_job(job_id, status="running")
        await update_job(job_id, stages={"dem": "done"})  # merges into existing stages
    """
    job = await get_job(job_id)
    if job is None:
        return

    for key, value in kwargs.items():
        if key == "stages" and isinstance(value, dict):
            job["stages"].update(value)
        elif key == "results" and isinstance(value, dict):
            job["results"].update(value)
        else:
            job[key] = value

    await _redis.set(f"job:{job_id}", json.dumps(job), ex=_JOB_TTL_SECONDS)
