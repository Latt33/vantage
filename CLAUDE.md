# CLAUDE.md — AI2PB Development Guide

This file is the source of truth for how this project is developed. Read it before making any change.
Update it when a decision is made that affects architecture, conventions, or data sources.

---

## Project Purpose

Automate Intelligence Preparation of the Battlespace (IPB) from open-source data.
Given a geographic bounding box and timeframe, the system fetches, processes, and visualizes
operationally relevant data: terrain, weather, infrastructure, population, and surveillance windows.

The primary target areas are in Finland. The tool should work for any EU area.
Non-EU and non-Finnish data sources are acceptable only if no EU equivalent exists.

---

## Core Design Principle: Replaceable Features

Every data feature (terrain, weather, cell towers, etc.) must be independently removable or
replaceable without breaking any other feature. This means:

- Each data source lives in its own subfolder under `backend/src/service/`
- No feature imports from another feature's subfolder
- All cross-cutting utilities (HTTP client, BBox, GeoJSON builders) live in `backend/src/service/_shared/`
- The orchestrator in `backend/src/jobs/` is the only place that wires features together
- API endpoints in `backend/src/api/` call the orchestrator, not individual services directly

If you can delete a service subfolder and the only thing that breaks is the orchestrator import,
the design is correct.

---

## Repository Structure

```
backend/
  src/
    api/
      main.py              # FastAPI app — routing only, no business logic
    jobs/
      store.py             # Redis-backed job store
      orchestrator.py      # The only place that wires service calls together
    service/
      _shared/             # Utilities shared across all services (bbox, http client, geojson)
      <source>/            # One folder per data source (e.g. nls/, ecmwf/, osm/)
        <feature>.py       # One file per feature within that source (e.g. dem.py, wind.py)
frontend/
  src/
    components/            # UI pieces (map canvas, sidebars, progress screen, etc.)
    context/               # Operational state, layer visibility, job polling
```

One source, one folder. If a source provides multiple features (e.g. elevation and imagery
from the same API), each feature gets its own file inside that source folder. If a source
provides only one feature, a single file is enough — no need for a subfolder of files.

The `_shared/` folder is the only exception: it holds utilities that every source uses
(BBox dataclass, shared HTTP client, GeoJSON builders). Nothing in `_shared/` is
feature-specific.

---

## Data Source Policy

Prefer EU and Finnish sources. Order of preference:

1. Finnish national authority (NLS, FMI, Digiroad, Statistics Finland)
2. EU/ESA source (Copernicus DEM, ECMWF)
3. Neutral community source (OpenStreetMap, OpenCelliD)
4. Non-EU source only if no alternative exists — document the reason in a comment

Do not add NASA/NOAA/US-government sources without noting why no EU equivalent was used.

---

## Job Pipeline

The backend uses an asynchronous polling pattern:

1. `POST /api/prepare` — validates BBox, creates a Redis job entry (`status: pending`), fires
   `BackgroundTasks.add_task(run_job, job_id, bbox)`, returns `{ job_id }`
2. `GET /api/status/{job_id}` — reads from Redis, returns per-stage progress
3. `GET /api/layers/{job_id}` — returns assembled GeoJSON when `status == completed`

Job state shape in Redis (stored as JSON string under key `job:{job_id}`):
```json
{
  "status": "pending | running | completed | error",
  "stages": {
    "dem": "pending | running | done | error",
    "weather": "pending | running | done | error",
    "infra": "pending | running | done | error"
  },
  "results": {}
}
```

Redis runs as a sidecar in `docker-compose.yml`. The backend connects via `REDIS_URL` env var
(default `redis://redis:6379`). This works identically on any cloud provider including AWS,
GCP, and any EU-based provider.

---

## Shared Utilities

### `_shared/bbox.py`
All services receive a `BBox` dataclass. Never pass raw coordinates as separate arguments.
```python
@dataclass
class BBox:
    min_lon: float
    min_lat: float
    max_lon: float
    max_lat: float
```

### `_shared/client.py`
One shared `httpx.AsyncClient` wrapper with timeout and retry. Named `client.py` not `http.py`
to avoid confusion with HTTP vs HTTPS protocol. All requests made through it use HTTPS URLs.

### `_shared/geojson.py`
Helpers for building GeoJSON Feature and FeatureCollection objects consistently across services.

---

## Deployment

- Frontend deploys on Vercel from the repo root using `vercel.json`.
- Backend deploys on Render from `backend/Dockerfile` via `render.yaml`.
- The frontend must set `VITE_API_BASE_URL` to the Render backend URL in production.
- Render must provide `REDIS_URL` and a persistent disk mount for `DATA_ROOT` if AOI data should survive restarts.
- Backend liveness is `GET /health`.

---

## Git Workflow

- All development happens on the `dev` branch
- Before starting any new work, pull latest from `main`:
  ```
  git checkout main && git pull && git checkout dev && git merge main
  ```
- Commit message format (every commit, no exceptions):
  ```
  Add: <what was added>
  Fix: <what was fixed, or "n/a">
  Other: <notes, or "n/a">
  ```
- Do not commit broken or placeholder code to `dev` — if a service is not yet implemented,
  it should return `{"status": "not_implemented"}` rather than raising an exception

### AI-assisted development note

When Claude (or any AI tool) writes files in this repo, it does so using file tools only.
It does NOT run git commands. The developer owns all git operations: staging, committing,
and pushing. This prevents `.git/index.lock` conflicts caused by AI processes running git
on a mounted filesystem alongside a live editor.

---

## What Not To Do

- Do not import from one service subfolder into another (e.g., `nls` must not import from `ecmwf`)
- Do not put business logic in `api/main.py` — it routes requests only
- Do not name any module `http.py` (shadows stdlib)
- Do not use in-memory dicts for job state — use Redis
- Do not add a US/non-EU data source without a comment explaining why no EU alternative was used
- Do not install packages without adding them to `requirements.txt`
