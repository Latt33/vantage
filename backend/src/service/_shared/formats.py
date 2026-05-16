"""Parquet grid format helpers — shared across spatial-field services.

A "parquet grid" is a flat table where each row is one (lon, lat, [time])
sample of a continuous field. The first two columns are always `lon` and
`lat` in WGS84 / EPSG:4326. See DATA_TYPES.md for the full spec.

Services that produce continuous fields (DEM, weather, …) write through
`write_parquet_grid`. Consumers that need the raw DataFrame (the mission
window analyser, for example) read through `read_parquet_grid`. Consumers
that need a GeoJSON FeatureCollection (the API layer) read through
`read_parquet_as_geojson`.
"""

from pathlib import Path

import pandas as pd

from src.service._shared.geojson import feature, feature_collection, point


def write_parquet_grid(path: Path, df: pd.DataFrame) -> None:
    """Write a grid DataFrame to Parquet, forcing lon/lat as the first two columns."""
    if "lon" not in df.columns or "lat" not in df.columns:
        raise ValueError("Parquet grid must contain `lon` and `lat` columns")
    others = [c for c in df.columns if c not in ("lon", "lat")]
    ordered = df[["lon", "lat", *others]]
    path.parent.mkdir(parents=True, exist_ok=True)
    ordered.to_parquet(path, index=False)


def read_parquet_grid(path: Path) -> pd.DataFrame:
    """Read a Parquet grid file as a raw DataFrame."""
    return pd.read_parquet(path)


def read_parquet_as_geojson(path: Path) -> dict:
    """Convert a Parquet grid to a GeoJSON FeatureCollection (one Point per row)."""
    df = read_parquet_grid(path)
    features: list[dict] = []
    other_cols = [c for c in df.columns if c not in ("lon", "lat")]
    for row in df.itertuples(index=False):
        row_dict = row._asdict()
        features.append(
            feature(
                geometry=point(float(row_dict["lon"]), float(row_dict["lat"])),
                properties={k: row_dict[k] for k in other_cols},
            )
        )
    return feature_collection(features, source="parquet_grid")
