# AI2PB — API Contract for Frontend

This document describes every backend endpoint the frontend needs to know about,
the exact shape of each response, and the recommended loading strategy.

---

## Base URL

Development:  `http://localhost:8000`
Production:   TBD (set as `VITE_API_BASE` in frontend env)

---

## Full flow

```
1.  User draws a bounding box on the map
2.  POST /api/prepare          → receive job_id
3.  Poll GET /api/status/{job_id} every 2 seconds
4.  As soon as a stage turns "done", fetch its layer:
      GET /api/layers/{job_id}/{layer_name}
    Don't wait for all stages — render each layer as it arrives.
5.  When status == "completed", all layers are available.
6.  GET /api/layers/{job_id} gives a manifest with source attribution
    for the explainability panel.
```

---

## Endpoints

### POST /api/prepare

Kick off a new analysis job.

**Request body (JSON):**
```json
{
  "min_lon": 24.8,
  "min_lat": 60.1,
  "max_lon": 25.2,
  "max_lat": 60.3
}
```

**Response 200:**
```json
{ "job_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6" }
```

**Response 422:** BBox validation failed (inverted coords, out of range, etc.)

---

### GET /api/status/{job_id}

Check progress. Poll this until `status == "completed"`.

**Response 200:**
```json
{
  "status": "running",
  "stages": {
    "terrain":        "done",
    "weather":        "running",
    "infrastructure": "pending"
  },
  "created_at": "2024-01-01T12:00:00+00:00"
}
```

Stage values: `pending` → `running` → `done | error`
Job status values: `pending` → `running` → `completed`

**Key behaviour:** stages run concurrently. `terrain` may be `done`
while `weather` is still `running`. Fetch ready layers immediately —
don't wait for `status == "completed"`.

**Response 404:** Job not found (expired after 2 hours or invalid ID)

---

### GET /api/layers/{job_id}

Returns a manifest of all layers with metadata. Does **not** include
GeoJSON payloads — use the per-layer endpoint below for that.

Use this for the explainability panel (source attribution, confidence).

**Response 200:**
```json
{
  "job_id": "3fa85f...",
  "layers": [
    {
      "name": "terrain",
      "status": "done",
      "source": "NLS Finland — Topographic Database",
      "confidence": "high",
      "feature_count": 87
    },
    {
      "name": "weather",
      "status": "done",
      "source": "Open-Meteo / ECMWF IFS",
      "confidence": "high",
      "feature_count": 72
    },
    {
      "name": "infrastructure",
      "status": "done",
      "source": "OpenStreetMap / Overpass API",
      "confidence": "medium",
      "feature_count": 213
    }
  ]
}
```

If a layer errored, `status` is `"error"` and an `"error"` string is included.

---

### GET /api/layers/{job_id}/{layer_name}

Returns the GeoJSON FeatureCollection for one layer.

`layer_name` is one of: `terrain`, `weather`, `infrastructure`

**Response 200:** GeoJSON FeatureCollection

```json
{
  "type": "FeatureCollection",
  "source": "NLS Finland — Topographic Database",
  "confidence": "high",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Polygon", "coordinates": [[...]] },
      "properties": {
        "nls_collection": "vedet",
        "nls_label": "Water bodies"
      }
    }
  ]
}
```

**Response 202:** Layer not ready yet (stage still `pending` or `running`)
**Response 404:** Job or layer not found

---

## Layer-specific property schemas

### terrain (source: NLS Finland)

Each feature has:
- `nls_collection`: raw collection ID (`vedet`, `virtavedet`, `maanpeite`)
- `nls_label`: human label (`"Water bodies"`, `"Waterways"`, `"Land cover"`)
- Any additional NLS-provided attributes

### weather (source: Open-Meteo / ECMWF IFS)

All features are Points at the BBox centroid. Each represents one hour.
All parameters come from a single ECMWF IFS request — the source delivers
all of these together, not as separate API calls.

- `time`: ISO timestamp (`"2024-01-01T12:00"`)

Mobility / trafficability:
- `precipitation_mm`: total hourly precipitation in mm
- `rain_mm`: rain component only (mm)
- `snowfall_cm`: fresh snowfall in cm
- `snow_depth_m`: total snow on ground in metres
- `soil_moisture_m3m3`: surface soil saturation (0–1), proxy for off-road trafficability

Air operations / surveillance:
- `wind_speed_ms`: 10 m wind speed in m/s
- `wind_direction_deg`: meteorological direction (degrees from north)
- `wind_gust_ms`: 10 m peak gust in m/s
- `visibility_m`: visibility in metres
- `cloudcover_pct`: total cloud cover 0–100 %
- `cloudcover_low_pct`: cloud cover below ~2 km (relevant for rotary-wing ops)

Personnel / equipment:
- `temperature_c`: 2 m air temperature in °C
- `apparent_temperature_c`: felt temperature in °C
- `humidity_pct`: relative humidity in %
- `dewpoint_c`: dewpoint in °C (fog and frost risk indicator)
- `pressure_hpa`: surface pressure in hPa (weather trend)
- `freezing_level_m`: altitude of 0°C isotherm in metres

### infrastructure (source: OpenStreetMap)

Roads and waterways are LineStrings; bridges and fords are Points.
All OSM tags are preserved as properties. Key ones:
- `highway`: road class (`primary`, `secondary`, `track`, etc.)
- `waterway`: waterway type (`river`, `stream`, etc.)
- `bridge`: `"yes"` when present
- `ford`: `"yes"` when present
- `name`: feature name if tagged in OSM
- `maxweight`: bridge weight limit if tagged (in tonnes)
- `osm_id`: OSM element ID
- `osm_type`: `"way"` or `"node"`

---

## Error handling

- If a layer has `"status": "error"` in its FeatureCollection, the `"error"` field
  explains what went wrong. The features array will be empty.
- The explainability panel should show the source and confidence for each layer
  regardless of whether it succeeded or errored.
- A job never gets stuck — it always reaches `"completed"` even if all stages error.

---

## Recommended polling implementation

```js
async function prepareAndLoad(bbox) {
  const { job_id } = await post('/api/prepare', bbox);

  const interval = setInterval(async () => {
    const status = await get(`/api/status/${job_id}`);

    for (const [layer, state] of Object.entries(status.stages)) {
      if (state === 'done' && !loadedLayers.has(layer)) {
        loadedLayers.add(layer);
        const geojson = await get(`/api/layers/${job_id}/${layer}`);
        addLayerToMap(layer, geojson);
      }
    }

    if (status.status === 'completed') {
      clearInterval(interval);
      const manifest = await get(`/api/layers/${job_id}`);
      updateExplainabilityPanel(manifest.layers);
    }
  }, 2000);
}
```
