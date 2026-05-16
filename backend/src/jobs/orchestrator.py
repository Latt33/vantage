"""Job orchestrator — the only place that wires service calls together.

Each stage is run sequentially for now. Stages are independent: a failure
in one stage logs an error and continues so the other layers still appear.

To add a new data source:
1. Create its module under backend/src/service/<source>/
2. Import it here and add a stage entry in STAGES
3. Nothing else needs to change

To remove a data source:
1. Delete its module
2. Remove it from STAGES here
3. Nothing else breaks
"""

import logging

from src.jobs.store import update_job
from src.service._shared.bbox import BBox
from src.service.ecmwf.wind import fetch_wind
from src.service.nls.dem import fetch_dem

logger = logging.getLogger(__name__)

# Ordered list of (stage_name, coroutine_factory) pairs.
# Add new sources here and nowhere else.
STAGES = [
    ("dem", fetch_dem),
    ("wind", fetch_wind),
]

STAGE_NAMES = [name for name, _ in STAGES]


async def run_job(job_id: str, bbox: BBox) -> None:
    """Execute all data-fetch stages for a job and update Redis at each step."""
    await update_job(job_id, status="running")

    for stage_name, fetch_fn in STAGES:
        await update_job(job_id, stages={stage_name: "running"})
        try:
            result = await fetch_fn(bbox)
            await update_job(
                job_id,
                stages={stage_name: "done"},
                results={stage_name: result},
            )
            logger.info("Job %s: stage '%s' completed", job_id, stage_name)
        except Exception as exc:
            logger.error("Job %s: stage '%s' failed: %s", job_id, stage_name, exc)
            await update_job(job_id, stages={stage_name: "error"})

    # Mark job complete even if individual stages errored — partial results
    # are still useful for the frontend to display.
    await update_job(job_id, status="completed")
    logger.info("Job %s: all stages finished", job_id)
