# AI2PB — Project Handoff

**What this is:** Automate Intelligence Preparation of the Battlespace (IPB) from open-source data.
Given a geographic bounding box, the system fetches terrain, weather, infrastructure, and
surveillance data, runs tactical analysis layers, and renders everything on a web map.
Primary target area: Finland. Must work for any EU area.

Read `CLAUDE.md` before touching anything. It is the authoritative development guide.

---

## Architecture in one paragraph

The **backend** (FastAPI + Redis) receives a bounding box, spins up 8 concurrent data-fetch
jobs (weather, DEM, water, land, infrastructure, cell towers, satellites, traffic cameras),
runs one derived analysis (MCOO trafficability) after, and stores everything on disk.
The **frontend** (React + MapLibre GL) polls job progress, then fetches layers from typed
API endpoints. The frontend has its own 3-tier registry: Sources → Derivatives → Analyses.
All data is ephemeral — stored in `backend/data/{aoi_id}/` at runtime, no database needed
beyond Redis for job state.

---

## Current state

### What works end-to-end

| Capability | Notes |
|---|---|
| BBox selection + job submission | MapLibre draw tool → POST `/api/aoi` → Redis job |
| Job progress polling | Per-stage status, live in UI |
| Weather forecast | ECMWF IFS via Open-Meteo, 3-day hourly, 25 variables, Parquet grid |
| DEM elevation | NLS Korkeusmalli 10m, Parquet grid, downsampled to 250k points |
| Water bodies + courses | NLS OGC Features, GeoJSON |
| Land cover + buildings | NLS OGC Features, GeoJSON |
| OSM infrastructure | Overpass API → OSM XML, served as GeoJSON sub-layers (roads, bridges, fuel, power, healthcare, water works) |
| Cell towers | OpenCelliD, GeoJSON Points |
| Satellite passes | N2YO radiopasses (ISS, Sentinel-1A, Resurs-P 2, Landsat 9), GeoJSON Points |
| Traffic cameras | Fintraffic Digitraffic, GeoJSON Points with image URLs |
| MCOO trafficability | Derived from land + water + slope; GeoJSON polygon zones |
| Login flow | Password-gated (`VITE_OPS_PASSWORD`) |
| Layer panel | Visibility toggles + opacity sliders, real data from 4 sources |
| Capability cards | UI for 6 tactical analysis types |

### What is incomplete

**Frontend (Tier 2 — Derivatives):** All four derivative computations are stubs:
- `open_areas` — exposure polygons from landcover/forest
- `chokepoints` — movement constraint points from terrain + open_areas
- `slope_grades` — trafficability classes from DEM
- `viewshed` — line-of-sight from terrain

**Frontend (Tier 3 — Analyses):** All six tactical analysis `run()` functions are stubs:
- `heavy_vehicle_corridors`, `drone_shelter_positions`, `infantry_concealment`
- `artillery_firing_positions`, `logistics_routes`, `fortification_sites`

**Other gaps:**
- `TimeSlider` UI exists but is not wired to weather forecast time steps
- `ToolPanel` buttons have no functionality
- `terrain` and `population` sources are `PLACEHOLDER_LOAD`
- Slope calculation is missing (DEM exists; no service computes slope grid)
- Viewshed computation not designed or implemented

---

## Running locally

```bash
# Backend (FastAPI + Redis via Docker)
cd backend
cp .env.example .env          # fill in API keys
docker compose up --build

# Frontend
cd frontend
cp .env.example .env          # fill in VITE_MAPTILER_KEY etc.
npm install
npm run dev
```

### Required API keys

| Key | Where | Required for |
|---|---|---|
| `MML_API_KEY` | backend `.env` | NLS water, land, DEM (works without key but rate-limited) |
| `N2YO_API_KEY` | backend `.env` | Satellite passes (skipped if missing) |
| `OPENCELLID_API_KEY` | backend `.env` | Cell towers (skipped if missing) |
| `VITE_MAPTILER_KEY` | frontend `.env` | Map tile background (required) |
| `VITE_OPS_PASSWORD` | frontend `.env` | Login gate (default: `GHOST01`) |

---

## File map — key files only

```
CLAUDE.md                          authoritative dev guide — read first
HANDOFF.md                         this file

backend/
  requirements.txt                 pandas + pyarrow + rasterio added recently
  src/
    service/_shared/
      formats.py                   ← canonical I/O for all three storage formats
      storage.py                   filesystem helpers, TTL staleness checks
      bbox.py, client.py, geojson.py
    service/
      ecmwf/weather.py             Open-Meteo → Parquet grid
      nls/dem.py                   NLS WCS GeoTIFF → Parquet grid (rasterio reproject)
      nls/water.py, nls/land.py    NLS OGC → GeoJSON
      osm/infra.py                 Overpass → infra.osm (OSM XML)
      opencellid/towers.py         OpenCelliD → GeoJSON Points
      n2yo/satellite.py            N2YO passes → GeoJSON Points (ISO timestamps)
      digitraffic/weathercam.py    Digitraffic → GeoJSON Points
      analysis/mcoo.py             Derived trafficability zones → GeoJSON
    jobs/
      orchestrator.py              wires all 8 fetch + 1 derived stage
      store.py                     Redis job state
    api/
      _responses.py                serve_layer_file / serve_parquet_as_geojson / serve_osm_as_geojson
      routers/infrastructure.py    6 sub-layer endpoints from one infra.osm
      routers/dem.py, weather.py   Parquet → GeoJSON on the fly

frontend/src/
  pages/
    LoginPage.tsx
    AoiSelectPage.tsx              MapLibre BBox draw → POST /api/aoi
    OperationsPage.tsx             main map + panels + job polling
  components/
    LayerPanel.tsx                 right sidebar: layer toggles + opacity
    TimeSlider.tsx                 skeleton only, not wired
    ToolPanel.tsx                  skeleton only, no functionality
    CapabilityCard.tsx             rendered, analysis stubs
  context/
    sources/index.ts               ← SOURCES registry (6 sources; 4 wired, 2 stubs)
    derivatives/index.ts           ← DERIVATIVES registry (4 entries; all stubs)
    analyses/index.ts              ← ANALYSES registry (6 entries; all stubs)
    registry/cache.ts              memoisation cache for all three tiers
  data/
    capabilities.ts                6 capability definitions + icons
```

---

## Data storage format rules

Three canonical formats — do not invent others. See `CLAUDE.md → Data Storage Standards`
for full schemas. Decision tree:

- **Continuous spatial field** (elevation, wind speed over a grid)? → **Parquet grid** (lon, lat, value…)
- **Came from OpenStreetMap / Overpass** (OSM node/way IDs, tags)? → **OSM XML** (`.osm`)
- **Discrete points, polygons, lines from any other source**? → **GeoJSON** (`.geojson`)

The API always converts Parquet and OSM to GeoJSON before the frontend. The frontend
never reads `.parquet` or `.osm` files.

---

## What to work on next

**Highest-value unblocked tasks:**

1. **Slope grid service** — DEM Parquet exists. Add `backend/src/service/nls/slope.py`
   that reads `elevation.parquet`, computes slope using numpy gradient, writes
   `dem/slope.parquet` (columns: lon, lat, slope_deg). Register in orchestrator as a
   fetch stage after dem. This unblocks `slope_grades` derivative and MCOO improvement.

2. **Wire `TimeSlider` to weather data** — `forecast.parquet` has one row per (point × time).
   The frontend already loads weather; expose the unique `valid_time` values to `TimeSlider`
   and filter the GeoJSON by selected time step.

3. **`slope_grades` derivative** — reads `slope_deg` from DEM Parquet, bins into
   Go/Caution/Stop classes, returns GeoJSON polygon zones. Unblocks
   `heavy_vehicle_corridors` and `artillery_firing_positions` analyses.

4. **`viewshed` derivative** — line-of-sight computation from DEM. Needed by drone,
   infantry, and fortification analyses. Consider a simple 2D raycast or use a library
   like `viewshed-rs` via subprocess.

5. **Fill in Tier 3 analysis stubs** — once slope_grades and viewshed exist, the
   tactical analysis `run()` functions can be implemented. Each returns a GeoJSON
   FeatureCollection of recommended locations/routes.

6. **Terrain source in frontend** — `elevation.parquet` is served as GeoJSON Points
   with `elevation_m`. Render as a heatmap layer using MapLibre `heatmap` or interpolated
   raster. Replace the `PLACEHOLDER_LOAD` in `sources/index.ts`.

---

## Known issues / gotchas

- **`formats.py` is new** — installed 2026-05-16. Services and API routers use it,
  but if you see import errors on first run, verify `pandas`, `pyarrow`, and `rasterio`
  are installed (`pip install -r requirements.txt`).
- **NLS DEM without API key** — the WCS endpoint works without `MML_API_KEY` but may
  return an error for large bboxes. Keep test bboxes small (< 30 km²).
- **N2YO free tier** — 1000 API transactions/hour. Each job fetches 4 satellites × 3 days.
- **OSM Overpass** — public endpoint, can be slow (90 s timeout). For dense urban areas,
  the response can be large.
- **Data is ephemeral** — `backend/data/` is not volume-mounted. Container restarts clear
  all cached AoI data. This is intentional for now; add a bind mount or object storage
  for production.
- Legacy service files (`mml_data.py`, `dem_data.py`, `cache_manager.py`,
  `ecmwf_wind_data.py`) at `backend/src/service/` root are unused — safe to delete.

---

## Branch / git state

- Active branch: `atte`
- `main` is the merge target
- Commit format (enforced): `Add: / Fix: / Other:`
- Claude / AI tools write files only — all git operations are manual (prevents index.lock conflicts)
