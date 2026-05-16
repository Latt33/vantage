# Data Storage and Structure

All geospatial and analytical data for Areas of Interest (AoI) is stored ephemerally in this directory (`backend/data/`). The data is generated and cached at runtime and does not persist across container restarts.

## Storage Hierarchy

Data is structured hierarchically by AoI ID and then by category.

```text
backend/data/
└── {aoi_id}/
    ├── meta.json                     # Top-level AoI metadata (bbox, created_at)
    ├── dem/                          # Digital Elevation Model (Source: NLS / Maanmittauslaitos)
    │   ├── meta.json                 # Category metadata (fetched_at, source, confidence, feature counts)
    │   └── elevation.tiff            # GeoTIFF raster data
    ├── infrastructure/               # Infrastructure (Source: NLS)
    │   ├── meta.json
    │   └── roads.geojson             # GeoJSON FeatureCollection
    ├── land/                         # Land Cover (Source: NLS)
    │   ├── meta.json
    │   └── cover.geojson             # GeoJSON FeatureCollection
    ├── water/                        # Waterways and Bodies (Source: NLS)
    │   ├── meta.json
    │   ├── bodies.geojson            # GeoJSON FeatureCollection
    │   └── courses.geojson           # GeoJSON FeatureCollection
    ├── weather/                      # Weather Forecast (Source: Open-Meteo / ECMWF IFS)
    │   ├── meta.json
    │   └── forecast.json             # JSON forecast data
    ├── traffic_cameras/              # Traffic Cameras (Source: Digitraffic)
    │   ├── meta.json
    │   └── stations.geojson          # GeoJSON FeatureCollection
    └── mcoo/                         # Modified Combined Obstacle Overlay (Combined Analysis)
        ├── meta.json
        └── trafficability.geojson    # GeoJSON FeatureCollection
```

## Data Types by Source

1. **NLS (Maanmittauslaitos)**:
   - **DEM**: Downloaded and stored as GeoTIFF (`elevation.tiff`).
   - **Vector Data** (Infrastructure, Land, Water): Fetched from WFS or similar APIs and stored as standard GeoJSON `FeatureCollection`s.

2. **Open-Meteo / ECMWF IFS**:
   - **Weather**: Fetched as JSON and stored directly as `forecast.json`. Includes multi-point grid data and time steps.

3. **Digitraffic**:
   - **Traffic Cameras**: Fetched via REST API and parsed into a GeoJSON `FeatureCollection` of point features representing camera stations (`stations.geojson`).

4. **Internal Analysis (MCOO)**:
   - **Trafficability**: Derived from intersecting Land, Water, and other layers, and saved as a GeoJSON `FeatureCollection` (`trafficability.geojson`).

## Metadata (`meta.json`)

Each category folder contains a `meta.json` file which tracks the freshness and provenance of the data. This includes:
- `fetched_at`: Timestamp of when the data was retrieved (used for TTL/staleness checks).
- `source`: The original provider of the data.
- `confidence`: Qualitative confidence level of the data.
- `feature_counts`: Statistical summary of the data (e.g., number of features or grid points).
