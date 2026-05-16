# Backend Data Contracts

Frontend should treat each typed endpoint as the stable contract for one data product.

## Weather (ECMWF via Open-Meteo)

- Endpoint: `GET /api/aoi/{aoi_id}/weather/forecast`
- File: `weather/forecast.json`
- Shape:
  - `type`: `"WeatherGrid"`
  - `source`: string
  - `model`: `"ecmwf_ifs04"`
  - `grid.points`: array of `{ lat, lon }`
  - `grid.times`: array of ISO timestamps
  - `variables`: map of variable name -> `number[][]` indexed as `[point_index][time_index]`
- Key variables:
  - `wind_speed_ms`, `wind_direction_deg`, `wind_gust_ms`
  - `precipitation_mm`, `rain_mm`, `snowfall_cm`, `snow_depth_m`
  - `temperature_c`, `apparent_temperature_c`, `humidity_pct`, `visibility_m`

## Water (NLS)

- Endpoint: `GET /api/aoi/{aoi_id}/water/bodies`
- File: `water/bodies.geojson`
- Shape: GeoJSON FeatureCollection (lakes/ponds)

- Endpoint: `GET /api/aoi/{aoi_id}/water/courses`
- File: `water/courses.geojson`
- Shape: GeoJSON FeatureCollection (rivers/streams)

## Land (NLS)

- Endpoint: `GET /api/aoi/{aoi_id}/land/cover`
- File: `land/cover.geojson`
- Shape: GeoJSON FeatureCollection (land cover polygons)

- Endpoint: `GET /api/aoi/{aoi_id}/land/cover.png`
- File: `land/cover.png`
- Shape: Cropped raster overlay PNG for land-use rendering

- Endpoint: `GET /api/aoi/{aoi_id}/land/forest`
- File: `land/forest.geojson`
- Shape: GeoJSON FeatureCollection (forest-only polygons derived from land cover)

- Endpoint: `GET /api/aoi/{aoi_id}/land/forest.png`
- File: `land/forest.png`
- Shape: Cropped raster overlay PNG for forest-density rendering

- Endpoint: `GET /api/aoi/{aoi_id}/land/buildings`
- File: `land/buildings.geojson`
- Shape: GeoJSON FeatureCollection (building footprints)

## Infrastructure (NLS)

- Endpoint: `GET /api/aoi/{aoi_id}/infrastructure/roads`
- File: `infrastructure/roads.geojson`
- Shape: GeoJSON FeatureCollection (road network)

## DEM (NLS WCS)

- Endpoint: `GET /api/aoi/{aoi_id}/dem/elevation`
- File: `dem/elevation.parquet`
- Shape: Parquet grid (WGS84) — points with `lon`, `lat`, `elevation_m` (derived from NLS GeoTIFF)

- Endpoint: `GET /api/aoi/{aoi_id}/dem/elevation.png`
- File: `dem/elevation.png`
- Shape: Cropped raster overlay PNG in WGS84 for fast map rendering (colorized elevation)

Note: the backend fetches the NLS WCS GeoTIFF (EPSG:3067) and converts it to the Parquet grid
and a cropped PNG overlay for efficient serving and client-side rendering.

## Satellites (N2YO)

- Endpoint: `GET /api/aoi/{aoi_id}/satellites/passes`
- File: `satellites/passes.json`
- Shape:
  - `observer`: `{ lat, lon }`
  - `passes`: array of pass objects with `satellite_name`, `norad_id`, and start/max/end timing + azimuth fields

## Traffic Cameras (Digitraffic)

- Endpoint: `GET /api/aoi/{aoi_id}/traffic_cameras/stations`
- File: `traffic_cameras/stations.geojson`
- Shape: GeoJSON FeatureCollection of point stations
- Key properties:
  - `station_id`, `name`, `municipality`, `road_number`, `collection_status`, `updated_at`, `preset_ids`

- Endpoint: `GET /api/aoi/{aoi_id}/traffic_cameras/stations/{station_id}`
- Shape: JSON object with station metadata plus latest image list
- Key fields:
  - `station_id`, `name`, `updated_at`, `location`
  - `images[]` entries with `preset_id`, `image_url`, `thumbnail_url`, `measured_at`
  - `latest_image` mirrors the most recent entry in `images`

## MCOO (Derived)

- Endpoint: `GET /api/aoi/{aoi_id}/mcoo/trafficability`
- File: `mcoo/trafficability.geojson`
- Shape: GeoJSON FeatureCollection
- Feature properties:
  - `class`: `severely_restricted|restricted|unrestricted`
  - `label`: string
  - `sources`: array of input datasets used

## Shared Metadata Contract

- Endpoint: `GET /api/aoi/{aoi_id}/layers`
- Category entry fields:
  - `name`, `available`
  - optional when available: `stale`, `source`, `confidence`, `feature_counts`, `fetched_at`
