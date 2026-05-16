# Data Storage

Ephemeral AoI data — generated at runtime, not persisted across container restarts.

## Layout

```text
backend/data/{aoi_id}/
├── meta.json                              # bbox, created_at
├── dem/elevation.parquet                  # NLS — Parquet grid
├── infrastructure/roads.geojson           # NLS — GeoJSON
├── land/{cover,buildings}.geojson         # NLS — GeoJSON
├── water/{bodies,courses}.geojson         # NLS — GeoJSON
├── weather/forecast.parquet               # Open-Meteo — Parquet grid
├── traffic_cameras/stations.geojson       # Digitraffic — GeoJSON
├── cellular/towers.geojson                # OpenCellID — GeoJSON
├── satellites/passes.geojson              # N2YO — GeoJSON
└── mcoo/trafficability.geojson            # Derived — GeoJSON
```

Each category folder also contains `meta.json` with `fetched_at`, `source`, `confidence`, `feature_counts`.

## Formats

- **Parquet grid** — continuous spatial fields (DEM, weather). Columns `lon`, `lat` first, then one column per variable. Served as GeoJSON Point features via the API.
- **GeoJSON** — discrete features (points, polygons, lines).

## Staleness

TTLs in [storage.py](../src/service/_shared/storage.py): weather 6h, traffic_cameras 1h, infrastructure/mcoo 24h, water/land 7d. Stale categories are refetched on the next `/api/prepare`.
