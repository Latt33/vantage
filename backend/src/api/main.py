"""FastAPI entrypoint — app wiring only, no feature logic."""

from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.routers import aoi
from src.api.routers import cellular
from src.api.routers import dem
from src.api.routers import infrastructure
from src.api.routers import jobs
from src.api.routers import land
from src.api.routers import layers
from src.api.routers import mcoo
from src.api.routers import mml
from src.api.routers import satellites
from src.api.routers import system
from src.api.routers import traffic_cameras
from src.api.routers import water
from src.api.routers import weather
from src.service._shared.client import close_client

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
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
app.include_router(cellular.router)
app.include_router(jobs.router)
app.include_router(layers.router)
app.include_router(weather.router)
app.include_router(water.router)
app.include_router(land.router)
app.include_router(infrastructure.router)
app.include_router(dem.router)
app.include_router(satellites.router)
app.include_router(traffic_cameras.router)
app.include_router(mcoo.router)
app.include_router(mml.router)
