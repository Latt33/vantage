"""Job orchestrator — wires service calls to AoI categories.

Each stage maps to one category folder under src/data/{aoi_id}/.
Stages run concurrently since all fetches are I/O bound.

Staleness is checked per category before fetching — if a category's data
is still fresh on disk, its stage is skipped entirely and marked done
immediately. Only stale or missing categories trigger a network request.

To add a data source:
    1. Create backend/src/service/<source>/<feature>.py
       — function signature: async def fetch_X(aoi_id: str, bbox: BBox) -> dict
    2. Import here and add to STAGES
    3. Nothing else changes

To remove a data source:
    1. Delete its module
    2. Remove it from STAGES
    3. Nothing else breaks
"""

import asyncio
import logging

from src.jobs.store import set_job_status, set_stage_status
from src.service._shared.bbox import BBox
from src.service._shared.storage import is_stale
from src.service.ecmwf.weather import fetch_weather
from src.service.nls.dem import fetch_dem
from src.service.nls.land import fetch_land
from src.service.nls.water import fetch_water
from src.service.nls.infra import fetch_infra
from src.service.n2yo.satellite import fetch_satellites
from src.service.opencellid.towers import fetch_towers
from src.service.analysis.mcoo import build_mcoo
from src.service.digitraffic.weathercam import fetch_weathercam

logger = logging.getLogger(__name__)

# stage_name must match the category folder name under src/data/{aoi_id}/
FETCH_STAGES: list[tuple[str, object]] = [
    ("weather",         fetch_weather),
    ("water",           fetch_water),
    ("land",            fetch_land),
    ("infrastructure",  fetch_infra),
    ("dem",             fetch_dem),
    ("satellites",      fetch_satellites),
    ("cellular",        fetch_towers),
    ("traffic_cameras", fetch_weathercam),
]

DERIVED_STAGES: list[tuple[str, object]] = [
    ("mcoo",            build_mcoo),
]

STAGES: list[tuple[str, object]] = FETCH_STAGES + DERIVED_STAGES
STAGE_NAMES: list[str] = [name for name, _ in STAGES]


async def _run_stage(
    job_id: str,
    aoi_id: str,
    stage_name: str,
    fetch_fn,
    bbox: BBox,
) -> None:
    """Run one stage: skip if fresh, otherwise fetch and write to disk."""
    if not is_stale(aoi_id, stage_name):
        logger.info("Job %s: stage '%s' cache hit — skipping fetch", job_id, stage_name)
        await set_stage_status(job_id, stage_name, "done")
        return

    await set_stage_status(job_id, stage_name, "running")
    try:
        summary = await fetch_fn(aoi_id, bbox)
        await set_stage_status(job_id, stage_name, "done")
        logger.info("Job %s: stage '%s' done — %s", job_id, stage_name, summary)
    except Exception as exc:
        logger.error("Job %s: stage '%s' unhandled error: %s", job_id, stage_name, exc)
        await set_stage_status(job_id, stage_name, "error")


async def run_job(job_id: str, aoi_id: str, bbox: BBox) -> None:
    """Run all stages concurrently for the given AoI."""
    await set_job_status(job_id, "running")

    await asyncio.gather(*[
        _run_stage(job_id, aoi_id, name, fn, bbox)
        for name, fn in FETCH_STAGES
    ])

    for name, fn in DERIVED_STAGES:
        await _run_stage(job_id, aoi_id, name, fn, bbox)

    await set_job_status(job_id, "completed")
    logger.info("Job %s: all stages finished for AoI %s", job_id, aoi_id)
