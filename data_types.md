# Data Types Reference

This document describes every data file the backend produces, what format it uses, and why.

---

## Decision Tree — Pick the right format

```
Is it a continuous spatial field (a grid of numbers over an area)?
  e.g. elevation, wind speed, temperature
  → Parquet grid (.parquet)

Did the data come from OpenStreetMap / Overpass API?
  e.g. roads, bridges, fuel stations fetched via Overpass
  → OSM XML (.osm)

Is it discrete points, lines, or polygons from any other source?
  e.g. satellite passes, cell towers, camera locations
  → GeoJSON FeatureCollection (.geojson)
```

**The frontend never reads `.parquet` or `.osm` directly.**
The API layer converts both to GeoJSON on the fly before sending to the client.

---

## Format 1: Parquet Grid (`.parquet`)

**When:** continuous spatial field — a regular or irregular grid where each row is one location
and one point in time.

**Rules:**
- First two columns are always `lon` (float64) and `lat` (float64) in WGS84 / EPSG:4326.
- No other CRS is permitted in Parquet files.
- Write via `write_parquet_grid(path, df)` from `_shared/formats.py` — it enforces column order.
- Read/serve via `serve_parquet_as_geojson(...)` or `read_parquet_as_geojson(path)`.

### `dem/elevation.parquet`

Source: NLS Finland — Korkeusmalli 10m (WCS)

| Column | Type | Unit |
|---|---|---|
| `lon` | float64 | degrees east |
| `lat` | float64 | degrees north |
| `elevation_m` | float32 | metres above sea level |

### `weather/forecast.parquet`

Source: ECMWF IFS via Open-Meteo (one row per grid-point × time-step)

| Column | Type | Unit / Notes |
|---|---|---|
| `lon` | float64 | degrees east |
| `lat` | float64 | degrees north |
| `valid_time` | str | ISO 8601 UTC timestamp of the forecast step |
| `wind_speed_ms` | float32 | m/s at 10 m |
| `wind_dir_deg` | float32 | degrees from north at 10 m |
| `wind_gust_ms` | float32 | m/s at 10 m |
| `wind_speed_120m_ms` | float32 | m/s at 120 m |
| `wind_dir_120m_deg` | float32 | degrees from north at 120 m |
| `precipitation_mm` | float32 | mm/h |
| `rain_mm` | float32 | mm/h |
| `snowfall_cm` | float32 | cm/h |
| `snow_depth_m` | float32 | m |
| `soil_moisture_m3m3` | float32 | m³/m³ |
| `visibility_m` | float32 | metres |
| `weather_code` | float32 | WMO weather code |
| `cloudcover_pct` | float32 | % total cloud cover |
| `cloudcover_low_pct` | float32 | % |
| `cloudcover_mid_pct` | float32 | % |
| `cloudcover_high_pct` | float32 | % |
| `temperature_c` | float32 | °C at 2 m |
| `apparent_temperature_c` | float32 | °C |
| `humidity_pct` | float32 | % at 2 m |
| `dewpoint_c` | float32 | °C |
| `pressure_hpa` | float32 | hPa |
| `freezing_level_m` | float32 | m |
| `soil_temperature_c` | float32 | °C |
| `shortwave_radiation_wm2` | float32 | W/m² |

---

## Format 2: OSM XML (`.osm`)

**When:** the data came from OpenStreetMap via the Overpass API.

**Rules:**
- Standard OSM 0.6 format.
- One `.osm` file per service category (never split into multiple files).
- Preserve original OSM node/way IDs and all tags verbatim — do not filter before writing.
- Write via `write_osm(path, elements)` from `_shared/formats.py`.
- Read/serve via `serve_osm_as_geojson(...)` with a `tag_filter` dict to serve typed sub-layers.
- Bare geometry nodes (no tags) are written too, so way coordinates can be reconstructed.

### `infrastructure/infra.osm`

Source: OpenStreetMap via Overpass API

Contains all of: roads (`highway`), bridges, fuel stations (`amenity=fuel`),
power infrastructure (`power`), and healthcare (`amenity=hospital|clinic|doctors`).

Each sub-layer is served by its own API endpoint that filters on the fly:

| Sub-layer endpoint | `tag_filter` | `exclude_tags` |
|---|---|---|
| roads | `{"highway": None}` | `{"bridge": "yes"}` |
| bridges | `{"bridge": "yes"}` | — |
| fuel | `{"amenity": "fuel"}` | — |
| power | `{"power": None}` | — |
| healthcare | `{"amenity": ["hospital","clinic","doctors"]}` | — |

---

## Format 3: GeoJSON FeatureCollection (`.geojson`)

**When:** discrete points, lines, or polygons from any non-OSM source.

**Rules:**
- Root object: `{"type": "FeatureCollection", "features": [...]}`.
- Geometry in EPSG:4326 — do not embed a `crs` property (RFC 7946 default).
- Every feature must have `"source"` in `properties`.
- Write via `write_json(path, feature_collection)` from `_shared/storage.py`.
- Serve via `serve_layer_file(...)` — returned as-is with `application/geo+json`.

### `satellites/passes.geojson`

Source: N2YO API — radio pass predictions

Each feature is a Point at the AoI observer centroid.

```jsonc
{
  "type": "Feature",
  "geometry": {"type": "Point", "coordinates": [lon, lat]},
  "properties": {
    "source": "N2YO",
    "satellite_name": "Sentinel-1A (ESA Radar)",
    "norad_id": "39634",
    "start_time": "2024-01-01T10:00:00+00:00",   // ISO 8601 UTC
    "max_elevation_deg": 45.2,
    "max_time": "2024-01-01T10:04:00+00:00",
    "end_time": "2024-01-01T10:08:00+00:00",
    "start_az_compass": "NE",
    "end_az_compass": "SW"
  }
}
```

### `cellular/towers.geojson`

Source: OpenCelliD API (MCC=244, Finland)

Each feature is a Point at the cell tower location.

```jsonc
{
  "type": "Feature",
  "geometry": {"type": "Point", "coordinates": [lon, lat]},
  "properties": {
    "radio": "LTE",   // radio technology (GSM, UMTS, LTE, NR)
    "mcc": 244,       // mobile country code
    "mnc": 12,        // mobile network code
    "cellid": 12345,  // cell ID
    "range": 1000     // estimated coverage radius in metres
  }
}
```

The FeatureCollection has a top-level `"source": "OpenCelliD"` key.

---

## Adding a new service

1. Use the decision tree above to pick the format.
2. Write with the appropriate `_shared/formats.py` function:
   - Parquet → `write_parquet_grid(path, df)`
   - OSM XML → `write_osm(path, elements)`
   - GeoJSON → `write_json(path, feature_collection)` from `_shared/storage.py`
3. Document the output file name and full property schema in the service module's docstring (see `nls/dem.py` or `ecmwf/weather.py` for examples).
4. Add a typed API endpoint in `api/routers/` using the matching response helper from `_responses.py`.
5. Add the file name and schema to this document.

---

## Service contract — write the file or raise

Every `fetch_*` function must satisfy exactly one of these outcomes before returning:

- **Success path:** write the data file, then write `meta.json`, then return a summary dict.
- **Failure path (Parquet/OSM services):** do **not** catch the exception — let it propagate to the orchestrator, which marks the stage `"error"`. Do **not** write `meta.json` without a data file.
- **Graceful-degradation path (GeoJSON services only):** if an API key is missing or the API returns no data, write an **empty** GeoJSON FeatureCollection + `meta.json`, then return normally. Examples: `towers.py`, `satellite.py`.

Why this matters: `is_stale` treats `meta.json` as proof that valid data exists. Writing `meta.json` without a data file poisons the cache — the next job skips the fetch, the file still doesn't exist, and the frontend gets a 404.