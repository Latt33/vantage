# AI2PB API Contract

Base URL: `http://localhost:8000`

This document lists the frontend-facing HTTP contract. Payload schemas are intentionally concise.

## Lifecycle

1. `POST /api/aoi` to create an AOI and enqueue a job.
2. Poll `GET /api/job/{job_id}/status` until `status == "completed"`.
3. Fetch per-feature outputs using typed endpoints (`/weather/forecast`, `/water/bodies`, ...).
4. Optionally call `GET /api/aoi/{aoi_id}/layers` for source/confidence metadata.

## Endpoints

### System

- `GET /health`
  - `200`: `{ "status": "ok" }`

### AOI + Jobs

- `POST /api/aoi`
  - Request:
    ```json
    {
      "min_lon": 24.8,
      "min_lat": 60.1,
      "max_lon": 25.2,
      "max_lat": 60.3
    }
    ```
  - `200`: `{ "aoi_id": "uuid", "job_id": "uuid" }`
  - `422`: invalid bbox

- `GET /api/aoi/{aoi_id}/status`
  - `404`: unknown AOI
  - `501`: AOI-indexed lookup not implemented; use job endpoint

- `GET /api/job/{job_id}/status`
  - `200`:
    ```json
    {
      "job_id": "uuid",
      "aoi_id": "uuid",
      "status": "pending|running|completed|error",
      "stages": {
        "weather": "pending|running|done|error",
        "water": "pending|running|done|error",
        "land": "pending|running|done|error",
        "infrastructure": "pending|running|done|error",
        "dem": "pending|running|done|error",
        "satellites": "pending|running|done|error",
        "traffic_cameras": "pending|running|done|error",
        "mcoo": "pending|running|done|error"
      },
      "created_at": "ISO-8601"
    }
    ```
  - `404`: unknown/expired job

- `POST /api/aoi/{aoi_id}/refresh/{category}`
  - `category` in: `weather|water|land|infrastructure|dem|satellites|traffic_cameras|mcoo`
  - `200`: `{ "job_id": "uuid", "aoi_id": "uuid", "refreshing": "category" }`
  - `404`: unknown AOI/category

### Generic Layer Access

- `GET /api/aoi/{aoi_id}/layers`
  - `200`:
    ```json
    {
      "aoi_id": "uuid",
      "categories": [
        {
          "name": "weather",
          "available": true,
          "stale": false,
          "source": "Open-Meteo / ECMWF IFS",
          "confidence": "high",
          "feature_counts": { "grid_points": 9, "time_steps": 72 },
          "fetched_at": "ISO-8601"
        }
      ]
    }
    ```
  - `404`: unknown AOI

- `GET /api/aoi/{aoi_id}/layers/{category}/{filename}`
  - Raw file read with path traversal protection
  - `404`: unknown AOI/category/file
  - `400`: invalid filename

### Typed Per-Feature Reads

- `GET /api/aoi/{aoi_id}/weather/forecast` -> `weather/forecast.json`
- `GET /api/aoi/{aoi_id}/water/bodies` -> `water/bodies.geojson`
- `GET /api/aoi/{aoi_id}/water/courses` -> `water/courses.geojson`
- `GET /api/aoi/{aoi_id}/land/cover` -> `land/cover.geojson`
- `GET /api/aoi/{aoi_id}/land/buildings` -> `land/buildings.geojson`
- `GET /api/aoi/{aoi_id}/infrastructure/roads` -> `infrastructure/roads.geojson`
- `GET /api/aoi/{aoi_id}/dem/elevation` -> `dem/elevation.tiff`
- `GET /api/aoi/{aoi_id}/satellites/passes` -> `satellites/passes.json`
- `GET /api/aoi/{aoi_id}/traffic_cameras/stations` -> `traffic_cameras/stations.geojson`
- `GET /api/aoi/{aoi_id}/mcoo/trafficability` -> `mcoo/trafficability.geojson`

All typed reads:
- `200`: file payload (JSON, GeoJSON, or TIFF)
- `404`: unknown AOI or file not produced yet
- `400`: invalid filename (generic route only)

### MML Debug

- `GET /terrain/mml/collections`
  - `200`: MML OGC collection list
