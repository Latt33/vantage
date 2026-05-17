# Vantage | Automated Intelligence Preparation of the Battlefield

**Team:** Atte Laakso, Nikolas Juhava, Qilun Li

Vantage is an operational planning tool that automates IPB using open-source data. Draw an area on the map, and the system fetches, analyses, and visualises everything an operational planner needs - terrain, weather, infrastructure, surveillance, and derived tactical assessments in minutes, not weeks.

## Dashboard Overview

The Vantage dashboard is a map-first operational interface built around a four-step workflow:

1. **Login** - password-gated access to the operations environment
2. **Area of Interest selection** - full-Finland map where the user draws a bounding box (max 30 x 30 km) to define the target area
3. **Capability selection** - choose which force elements and capabilities are relevant to the mission
4. **Operations view** - the main dashboard where all data and analysis comes together

The operations view includes:

- a MapLibre-powered tactical map with satellite and terrain base layers
- a left-hand **Tool Panel** with force element descriptions, infrastructure tree, and export controls
- a right-hand **Layer Panel** for toggling natural filters (topography, forest, water) and surveillance overlays (RF coverage, cameras, satellite tracks)
- a bottom **Time Slider** spanning 72 hours that synchronises weather forecasts, satellite positions, and mission window scores as the user scrubs through time
- **Traffic camera modals** showing live imagery from stations within the AOI
- **Mission window modal** displaying optimal timing recommendations based on combined weather and satellite data
- **PDF export** for generating a complete IPB briefing document

The interface is designed for rapid decision support and not just viewing data, but understanding what it means for the mission.

## Features

| Component | Description |
|---|---|
| **Dynamic Weather Forecasts** | 72-hour ECMWF forecast timeline | wind, precipitation, visibility, snow depth, temperature — with an interactive time slider to see conditions evolve hour by hour |
| **Terrain & Topography** | Elevation models, slope analysis, land cover classification, forest density, and building footprints from Finland's National Land Survey |
| **Water Features** | Lakes, ponds, rivers, and streams mapped from NLS data |
| **Infrastructure** | Road networks, bridges, and built-up areas from NLS and OpenStreetMap |
| **Cell Tower Coverage** | Tower locations and RF coverage areas from OpenCelliD |
| **Satellite Surveillance** | Overpass predictions and orbital tracks for ICEYE, Sentinel, and other assets via N2YO |
| **Traffic Cameras** | Live camera feeds from Finland's Digitraffic network |
| **Terrain Trafficability (MCOO)** | Automated classification of terrain as unrestricted, restricted, or severely restricted for vehicle movement |
| **Movement Corridors** | Identification of likely routes through terrain based on trafficability and road networks |
| **Mission Window Scoring** | Cross-references weather forecasts with satellite overpass schedules to recommend optimal timing for operations |
| **FPV Drone Threat Modelling** | Assesses area vulnerability to drone-based threats using terrain and cover data |
| **IPB Report Export** | Synthesised PDF report ready to brief | the same product that traditionally takes 2-4 weeks |

## How It Works

1. **Define Area of Interest** | Draw a bounding box on the map
2. **Automated Data Collection** | The backend orchestrator launches concurrent fetch jobs across all data sources
3. **Processing** | Raw data is processed into standardised GeoJSON and raster formats
4. **Derived Analysis** | MCOO, movement corridors, mission windows, and threat models are computed from the base layers
5. **Visualisation** | Everything renders on the interactive map with layer controls and a 72-hour time slider
6. **Live Updates** | Each data layer tracks its own freshness and can be individually refreshed as conditions change
7. **Export** | Generate a synthesised PDF IPB report ready to brief

## Architecture

```
backend/
  src/
    api/            FastAPI routing layer + per-feature route handlers
    jobs/           Redis-backed job store and orchestrator
    service/        One folder per data source + shared utilities + derived analysis
  data/             AOI results stored per job

frontend/
  src/
    pages/          Login, AOI selection, capabilities, operations dashboard
    components/     Map controls, layer panel, time slider, modals
    sources/        Data source registry and loaders
    export/         PDF report generation
```

Each data source is a standalone module under `service/`. The orchestrator is the only place that wires them together. You can remove any source without breaking the rest.

## Setup

### Prerequisites

- Python 3.12+
- Node.js 18+
- Docker and Docker Compose

### 1. Clone the repository

```bash
git clone <repo-url>
cd defence_hack
```

### 2. Get API keys

You will need keys from the following services:

| Service | Purpose | Where to get it |
|---|---|---|
| MML / National Land Survey | Terrain, land cover, water, infrastructure | [maanmittauslaitos.fi](https://www.maanmittauslaitos.fi/en) |
| N2YO | Satellite overpass predictions | [n2yo.com](https://www.n2yo.com/) |
| MapTiler | Base map tiles | [maptiler.com](https://www.maptiler.com/) |
| OpenCelliD | Cell tower locations | [opencellid.org](https://opencellid.org/) |

### 3. Start the backend

```bash
cd backend
cp .env.example .env
```

Add your API keys to `.env`:

```
MML_API_KEY=your-key
N2YO_API_KEY=your-key
MAPTILER_API_KEY=your-key
CELLS_API_KEY=your-key
```

Start with Docker (recommended — includes Redis):

```bash
docker compose up --build
```

Or without Docker (requires a local Redis instance on port 6379):

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn src.api.main:app --reload
```

Backend runs on `http://localhost:8000`. API docs at `http://localhost:8000/docs`.

### 4. Start the frontend

```bash
cd frontend
cp .env.example .env
```

Add your keys to `.env`:

```
VITE_MAPTILER_KEY=your-key
VITE_API_BASE_URL=http://localhost:8000
VITE_OPS_PASSWORD=your-password
```

```bash
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`.

### 5. Use the tool

1. Open `http://localhost:5173` and log in with the password you set
2. Draw a bounding box on the map to define your area of interest
3. Select relevant force capabilities
4. Wait for the backend to finish fetching and processing (progress shown per stage)
5. Explore the operations dashboard — toggle layers, scrub the timeline, check camera feeds
6. Export the IPB report as PDF when ready

## Data Sources

| Source | Data | Origin |
|---|---|---|
| National Land Survey (MML/NLS) | Elevation, land cover, forest, water, buildings, roads | Finland |
| ECMWF via Open-Meteo | 72-hour weather forecasts | EU |
| OpenStreetMap | Road and infrastructure networks | Open |
| OpenCelliD | Cell tower locations | Open |
| N2YO | Satellite overpass predictions | Open |
| Digitraffic | Live traffic camera feeds | Finland |
| MapTiler | Base map tiles and satellite imagery | EU |

Finnish and EU sources are prioritised. Non-EU sources are used only when no equivalent exists.

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, TypeScript, Vite, MapLibre GL JS, Framer Motion, Lucide React |
| **Backend** | Python 3.12, FastAPI, httpx, Shapely, Rasterio, Pandas |
| **Job Management** | Redis 7 |
| **Data Formats** | GeoJSON, GeoTIFF, PNG overlays, Parquet |
| **Deployment** | Docker Compose |
| **Report Export** | React-PDF |

## Team

Built by the **Vantage** team.

## Acknowledgements

Participated in the Junction Defence Hackathon — awarded second place among ~20 teams.
