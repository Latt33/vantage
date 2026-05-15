# Backend

Python FastAPI backend.

## Structure

- `src/api`: API endpoints used by the frontend.
- `src/service`: Feature-specific services (one file per feature).

## Option 1: Use uv (recommended)

```bash
cd backend
uv sync
uv run uvicorn src.api.main:app --reload
```

## Option 2: Run without uv and without Docker

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn src.api.main:app --reload
```

## Option 3: Run in Docker

```bash
cd backend
docker compose up --build
```

## Test individual parts without uv/docker

### Service function tests (direct Python)

```bash
cd backend
python -c "from src.service.ecmwf_wind_data import fetch_ecmwf_wind_data; print(fetch_ecmwf_wind_data())"
python -c "from src.service.dem_data import fetch_dem_data; print(fetch_dem_data())"
```

### API endpoint tests (curl)

```bash
curl http://localhost:8000/health
curl http://localhost:8000/wind/ecmwf
curl http://localhost:8000/terrain/dem
```
