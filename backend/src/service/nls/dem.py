"""Digital Elevation Model (DEM) from Maanmittauslaitos.

Fetches the 'korkeusmalli_10m' coverage from the NLS WCS API.
The raw GeoTIFF (EPSG:3067) is parsed in-memory with rasterio,
reprojected to WGS84 (EPSG:4326), and saved as a Parquet grid.

Output files:
    {aoi_id}/dem/elevation.parquet  — lon, lat, elevation_m (WGS84)
    {aoi_id}/dem/meta.json

Parquet schema:
    lon          float64   degrees east (EPSG:4326)
    lat          float64   degrees north (EPSG:4326)
    elevation_m  float32   metres above sea level
"""

import logging
import math
import os

import numpy as np
import pandas as pd
import rasterio
import rasterio.crs
from pyproj import Transformer

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.formats import write_parquet_grid
from src.service._shared.storage import category_file, ensure_dir, write_category_meta

logger = logging.getLogger(__name__)

_NLS_WCS_BASE = "https://avoin-karttakuva.maanmittauslaitos.fi/wcs/v2"
MML_API_KEY = os.getenv("MML_API_KEY", "")

# Transform WGS84 → ETRS-TM35FIN for the WCS request
_to_3067 = Transformer.from_crs("EPSG:4326", "EPSG:3067", always_xy=True)

# Cap output rows to keep Parquet files manageable for large AoIs.
# At 10 m resolution a 50 km × 50 km area would be 25 M pixels; we
# downsample so the grid never exceeds this many points.
_MAX_GRID_POINTS = 250_000


def _tiff_to_dataframe(tiff_bytes: bytes) -> pd.DataFrame:
    """Parse a GeoTIFF in memory and return a WGS84 lon/lat/elevation DataFrame."""
    with rasterio.MemoryFile(tiff_bytes) as memfile:
        with memfile.open() as ds:
            data = ds.read(1).astype("float32")   # first band, elevation values
            nodata = ds.nodata

            h, w = data.shape
            total = h * w
            step = max(1, math.isqrt(total // _MAX_GRID_POINTS) + 1)

            # Sample every `step`-th row and column
            row_idx = np.arange(0, h, step)
            col_idx = np.arange(0, w, step)
            rows, cols = np.meshgrid(row_idx, col_idx, indexing="ij")

            elevations = data[rows, cols].ravel().astype("float32")

            # Pixel centre coordinates in the source CRS (EPSG:3067)
            src_xs, src_ys = rasterio.transform.xy(
                ds.transform, rows.ravel(), cols.ravel(), offset="center"
            )

            # Reproject to WGS84 using the CRS stored in the TIFF
            src_crs = ds.crs.to_epsg() if ds.crs else 3067
            to_wgs84 = Transformer.from_crs(f"EPSG:{src_crs}", "EPSG:4326", always_xy=True)
            lons, lats = to_wgs84.transform(src_xs, src_ys)

            # Drop nodata pixels
            if nodata is not None:
                mask = elevations != nodata
            else:
                mask = np.isfinite(elevations)

            return pd.DataFrame({
                "lon": np.array(lons, dtype="float64")[mask],
                "lat": np.array(lats, dtype="float64")[mask],
                "elevation_m": elevations[mask],
            })


async def fetch_dem(aoi_id: str, bbox: BBox) -> dict:
    """Fetch MML DEM, convert to Parquet grid, and write to disk."""
    min_e, min_n = _to_3067.transform(bbox.min_lon, bbox.min_lat)
    max_e, max_n = _to_3067.transform(bbox.max_lon, bbox.max_lat)

    params = {
        "service": "WCS",
        "version": "2.0.1",
        "request": "GetCoverage",
        "coverageId": "korkeusmalli_10m",
        "subset": [f"E({min_e},{max_e})", f"N({min_n},{max_n})"],
        "format": "image/tiff",
    }

    auth = (MML_API_KEY, "") if MML_API_KEY else None
    resp = await client.get(_NLS_WCS_BASE, params=params, auth=auth)
    resp.raise_for_status()

    df = _tiff_to_dataframe(resp.content)
    out_path = category_file(aoi_id, "dem", "elevation.parquet")
    ensure_dir(out_path.parent)
    write_parquet_grid(out_path, df)

    n_points = len(df)
    logger.info("NLS DEM: %d grid points → elevation.parquet", n_points)
    write_category_meta(
        aoi_id, "dem",
        source="NLS Finland — Korkeusmalli 10m",
        confidence="high",
        feature_counts={"elevation.parquet": n_points},
    )
    return {"source": "NLS Finland — Korkeusmalli 10m", "grid_points": n_points}
