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

### `_shared/formats.py`
Canonical storage format utilities — write, read, and convert between the three storage formats.
**This is the authoritative reference for all data I/O.** Services must use these functions;
never roll their own file I/O for data output.

---

## Data Storage Standards

Every service must store its output in exactly one of three canonical formats.
Choose by answering:

```
Is it a continuous spatial field (grid of elevation, wind speed, temperature…)?
  → Parquet grid (.parquet)

Did it come from OpenStreetMap / Overpass (nodes/ways with real OSM IDs and tags)?
  → OSM XML (.osm)

Is it discrete points, polygons, or lines from any other source?
  → GeoJSON FeatureCollection (.geojson)
```

**The API layer always converts Parquet and OSM to GeoJSON before sending to the frontend.**
The frontend never reads `.parquet` or `.osm` files directly.

---

### Format 1: Parquet Grid (`.parquet`)

Used for: `dem/elevation.parquet`, `weather/forecast.parquet`.

**Mandatory columns — always first, always this type:**

| Column | Type | Description |
|---|---|---|
| `lon` | `float64` | Longitude in WGS84 / EPSG:4326, degrees east |
| `lat` | `float64` | Latitude in WGS84 / EPSG:4326, degrees north |

Additional columns follow, named per the schema below. No other CRS is permitted.
Use `write_parquet_grid(path, df)` from `_shared/formats.py` — it enforces column order.

**`dem/elevation.parquet` schema:**

| Column | Type | Unit |
|---|---|---|
| `lon` | `float64` | degrees east |
| `lat` | `float64` | degrees north |
| `elevation_m` | `float32` | metres above sea level |

**`weather/forecast.parquet` schema** (one row per grid-point × time-step):

| Column | Type | Unit |
|---|---|---|
| `lon` | `float64` | degrees east |
| `lat` | `float64` | degrees north |
| `valid_time` | `str` | ISO 8601 UTC — the forecast step |
| `wind_speed_ms` | `float32` | m/s at 10 m |
| `wind_dir_deg` | `float32` | degrees from north at 10 m |
| `wind_gust_ms` | `float32` | m/s at 10 m |
| `precipitation_mm` | `float32` | mm/h |
| `rain_mm` | `float32` | mm/h |
| `snowfall_cm` | `float32` | cm/h |
| `snow_depth_m` | `float32` | m |
| `visibility_m` | `float32` | metres |
| `cloudcover_pct` | `float32` | % |
| `temperature_c` | `float32` | °C at 2 m |
| `humidity_pct` | `float32` | % at 2 m |
| `pressure_hpa` | `float32` | hPa |
| *(and others — see `weather.py` for the full list)* | | |

---

### Format 2: GeoJSON FeatureCollection (`.geojson`)

Used for: all point, polygon, and line features from non-OSM sources.
Also used for derived/analysis outputs (MCOO zones).

Rules:
- Root object must be `{"type": "FeatureCollection", "features": [...]}`.
- Geometry in EPSG:4326 (the default per RFC 7946 — do not embed a CRS object).
- Every feature must have `"source"` in `properties`.
- Point features (towers, cameras, satellite passes): `geometry.type = "Point"`.
- Area/line features (water, land, MCOO): Polygon / MultiPolygon / LineString.

**`satellites/passes.geojson`** — each pass is a Point at the AoI observer location:

```json
{
  "type": "Feature",
  "geometry": {"type": "Point", "coordinates": [lon, lat]},
  "properties": {
    "source": "N2YO",
    "satellite_name": "Sentinel-1A",
    "norad_id": "39634",
    "start_time": "2024-01-01T10:00:00+00:00",
    "max_elevation_deg": 45.2,
    "max_time": "2024-01-01T10:04:00+00:00",
    "end_time": "2024-01-01T10:08:00+00:00",
    "start_az_compass": "NE",
    "end_az_compass": "SW"
  }
}
```

---

### Format 3: OSM XML (`.osm`)

Used for: `infrastructure/infra.osm` (all OSM-sourced infrastructure).

Standard OSM 0.6 format. **One `.osm` file per service category.**
The raw Overpass `elements` list is written verbatim via `write_osm(path, elements)`.
Original OSM node/way IDs and all tags are preserved.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="AI2PB/overpass">
  <node id="12345" lat="60.123" lon="24.456">
    <tag k="amenity" v="fuel"/>
  </node>
  <way id="67890">
    <nd ref="12345"/>
    <nd ref="12346"/>
    <tag k="highway" v="primary"/>
  </way>
</osm>
```

Bare geometry nodes (no tags) are also written so ways can have their
coordinates reconstructed during `read_osm_as_geojson`.

**API filtering:** Each typed endpoint (roads, bridges, fuel, …) calls
`serve_osm_as_geojson` with a `tag_filter` dict. See `_responses.py` and the
infrastructure router for examples.

---

### Adding a new service — format checklist

1. Determine format using the decision tree above.
2. Use the appropriate `_shared/formats.py` write function (`write_parquet_grid`,
   `write_osm`, or `write_json` for GeoJSON).
3. Add a typed API endpoint in `api/routers/` using `serve_parquet_as_geojson`,
   `serve_osm_as_geojson`, or `serve_layer_file` as appropriate.
4. Document the output file name and schema in the service module's docstring.
5. Update this file if you add a new file name or schema column.

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
