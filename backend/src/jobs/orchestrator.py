"""Job orchestrator — the only place that wires service calls together.

Stages run concurrently with asyncio.gather since every fetch is I/O bound.
A failure in one stage is isolated: the other stages continue and the job
still completes. The failed stage is marked "error" in Redis and the layer
key is stored with an error payload so the frontend can show why it's absent.

To add a data source:
    1. Create backend/src/service/<source>/<feature>.py
    2. Import the fetch function here and add it to STAGES
    3. Nothing else changes

To remove a data source:
    1. Delete its module
    2. Remove it from STAGES here
    3. Nothing else breaks
"""

import asyncio
import logging

from src.jobs.store import set_job_status, set_stage_status, store_layer
from src.service._shared.bbox import BBox
from src.service.ecmwf.weather import fetch_weather
from src.service.nls.terrain import fetch_terrain
from src.service.osm.infra import fetch_infra

logger = logging.getLogger(__name__)

# Add / remove sources here only.
# Format: (stage_name, async_fetch_fn)
# stage_name is what the frontend and API use to identify the layer.
STAGES: list[tuple[str, object]] = [
    ("terrain",        fetch_terrain),
    ("weather",        fetch_weather),
    ("infrastructure", fetch_infra),
]

STAGE_NAMES: list[str] = [name for name, _ in STAGES]


async def _run_stage(job_id: str, stage_name: str, fetch_fn, bbox: BBox) -> None:
    """Run a single stage, update Redis, and store the layer result."""
    await set_stage_status(job_id, stage_name, "running")
    try:
        result = await fetch_fn(bbox)
        await store_layer(job_id, stage_name, result)
        # Treat a service-level error (empty features + error field) as a warning,
        # not a hard failure — the layer still goes to Redis so the UI can explain it.
        if result.get("status") == "error":
            await set_stage_status(job_id, stage_name, "error")
            logger.warning("Job %s: stage '%s' returned service error", job_id, stage_name)
        else:
            await set_stage_status(job_id, stage_name, "done")
            logger.info("Job %s: stage '%s' completed (%d features)",
                        job_id, stage_name, len(result.get("features", [])))
    except Exception as exc:
        logger.error("Job %s: stage '%s' raised unhandled exception: %s", job_id, stage_name, exc)
        await set_stage_status(job_id, stage_name, "error")
        await store_layer(job_id, stage_name, {
            "type": "FeatureCollection",
            "features": [],
            "status": "error",
            "error": str(exc),
        })


async def run_job(job_id: str, bbox: BBox) -> None:
    """Execute all data-fetch stages concurrently and finalise job status."""
    await set_job_status(job_id, "running")

    await asyncio.gather(*[
        _run_stage(job_id, name, fn, bbox)
        for name, fn in STAGES
    ])

    await set_job_status(job_id, "completed")
    logger.info("Job %s: all stages finished", job_id)
