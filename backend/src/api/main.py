"""FastAPI entrypoint — app wiring only, no feature logic."""

import asyncio
import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.routers import aoi
from src.api.routers import cellular
from src.api.routers import dem
from src.api.routers import derived
from src.api.routers import infrastructure
from src.api.routers import jobs
from src.api.routers import land
from src.api.routers import layers
from src.api.routers import mcoo
from src.api.routers import mission_window
from src.api.routers import mml
from src.api.routers import satellites
from src.api.routers import satellite_imagery
from src.api.routers import system
from src.api.routers import traffic_cameras
from src.api.routers import water
from src.api.routers import weather
from src.service._shared.client import close_client
from src.service._shared.storage import ensure_test_areas

load_dotenv()

logger = logging.getLogger(__name__)


async def _bootstrap_test_areas() -> None:
    """Queue a fetch job for any test area that has missing or stale data."""
    from src.service._shared.test_areas import TEST_AREAS
    from src.service._shared.storage import is_stale
    from src.jobs.orchestrator import FETCH_STAGES, STAGE_NAMES, run_job
    from src.jobs.store import create_job, new_id

    for area in TEST_AREAS:
        missing = [name for name, _ in FETCH_STAGES if is_stale(area.aoi_id, name)]
        if not missing:
            continue
        job_id = new_id()
        try:
            await create_job(job_id, area.aoi_id, STAGE_NAMES)
            asyncio.create_task(run_job(job_id, area.aoi_id, area.bbox))
            logger.info(
                "Bootstrap: queued fetch for test area '%s' (job %s, missing: %s)",
                area.aoi_id, job_id, missing,
            )
        except Exception as exc:
            logger.warning("Bootstrap: could not queue fetch for '%s': %s", area.aoi_id, exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_test_areas()
    await _bootstrap_test_areas()
    yield
    await close_client()


app = FastAPI(title="AI2PB backend", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(system.router)
app.include_router(aoi.router)
app.include_router(jobs.router)
app.include_router(layers.router)
app.include_router(weather.router)
app.include_router(water.router)
app.include_router(land.router)
app.include_router(infrastructure.router)
app.include_router(dem.router)
app.include_router(satellites.router)
app.include_router(satellite_imagery.router)
app.include_router(cellular.router)
app.include_router(traffic_cameras.router)
app.include_router(mcoo.router)
app.include_router(mission_window.router)
app.include_router(mml.router)
app.include_router(derived.router)
