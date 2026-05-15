from fastapi import FastAPI

from src.service.dem_data import fetch_dem_data
from src.service.ecmwf_wind_data import fetch_ecmwf_wind_data

app = FastAPI(title="defence_hack backend")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/wind/ecmwf")
def get_ecmwf_wind_data() -> dict:
    return fetch_ecmwf_wind_data()


@app.get("/terrain/dem")
def get_dem_data() -> dict:
    return fetch_dem_data()
