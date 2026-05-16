"""Digital Elevation Model (DEM) from Maanmittauslaitos.

Fetches the 'korkeusmalli_2m' coverage from the NLS WCS API as a GeoTIFF,
converts it to a Parquet grid in WGS84 (EPSG:4326), and saves it.

The WCS endpoint expects coordinates in ETRS-TM35FIN (EPSG:3067); we
transform the BBox before the request and transform pixel centres back to
WGS84 after reading the raster.  To keep the output file manageable,
pixels are sampled at a step that caps the grid at ~90 000 points.

Output files:
    {aoi_id}/dem/elevation.parquet   — lon, lat, elevation_m
    {aoi_id}/dem/meta.json
"""

import logging
import os

import numpy as np
import pandas as pd
import rasterio
from rasterio.io import MemoryFile
from pyproj import Transformer

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.formats import write_parquet_grid
from src.service._shared.storage import category_file, write_category_meta, ensure_dir

logger = logging.getLogger(__name__)

_NLS_WCS_BASE = (
    "https://avoin-karttakuva.maanmittauslaitos.fi"
    "/ortokuvat-ja-korkeusmallit/wcs/v2"
)
MML_API_KEY = os.getenv("MML_API_KEY", "")

_to_3067 = Transformer.from_crs("EPSG:4326", "EPSG:3067", always_xy=True)
_to_4326 = Transformer.from_crs("EPSG:3067", "EPSG:4326", always_xy=True)

_MAX_GRID_POINTS = 90_000   # cap to keep Parquet file reasonable


def _tiff_to_parquet(tiff_bytes: bytes, out_path) -> int:
    """Parse an in-memory GeoTIFF (EPSG:3067) and write a WGS84 Parquet grid."""
    with MemoryFile(tiff_bytes) as mem:
        with mem.open() as ds:
            band = ds.read(1).astype("float32")
            nodata = ds.nodata
            height, width = band.shape

            # Downsample so the grid stays within the point cap.
            step = max(1, int((height * width / _MAX_GRID_POINTS) ** 0.5))
            rows_idx = np.arange(0, height, step)
            cols_idx = np.arange(0, width, step)

            row_grid, col_grid = np.meshgrid(rows_idx, cols_idx, indexing="ij")
            rows_flat = row_grid.ravel()
            cols_flat = col_grid.ravel()

            xs, ys = rasterio.transform.xy(ds.transform, rows_flat, cols_flat)
            lons, lats = _to_4326.transform(xs, ys)
            elevs = band[rows_flat, cols_flat]

            mask = (elevs != nodata) if nodata is not None else np.ones(len(elevs), dtype=bool)
            df = pd.DataFrame({
                "lon": lons[mask],
                "lat": lats[mask],
                "elevation_m": elevs[mask],
            })
            write_parquet_grid(out_path, df)
    return len(df)


async def fetch_dem(aoi_id: str, bbox: BBox) -> dict:
    """Fetch NLS DEM, convert to Parquet, and write to disk."""
    min_e, min_n = _to_3067.transform(bbox.min_lon, bbox.min_lat)
    max_e, max_n = _to_3067.transform(bbox.max_lon, bbox.max_lat)

    params = {
        "service": "WCS",
        "version": "2.0.1",
        "request": "GetCoverage",
        "coverageId": "korkeusmalli_2m",
        "subset": [f"E({min_e},{max_e})", f"N({min_n},{max_n})"],
        "format": "image/tiff",
    }

    out_path = category_file(aoi_id, "dem", "elevation.parquet")
    ensure_dir(out_path.parent)

    try:
        auth = (MML_API_KEY, "") if MML_API_KEY else None
        resp = await client.get(_NLS_WCS_BASE, params=params, auth=auth)
        resp.raise_for_status()

        n_points = _tiff_to_parquet(resp.content, out_path)
        logger.info("NLS DEM: %d points → elevation.parquet", n_points)

        write_category_meta(
            aoi_id, "dem",
            source="NLS Finland — Korkeusmalli 2m",
            confidence="high",
            feature_counts={"points": n_points},
        )
        return {"source": "NLS Finland — Korkeusmalli 2m", "points": n_points}

    except Exception as exc:
        logger.warning("NLS DEM fetch error: %s", exc)
        write_category_meta(
            aoi_id, "dem",
            source="NLS Finland — Korkeusmalli 2m",
            confidence="low",
            feature_counts={},
        )
        return {"source": "NLS Finland — Korkeusmalli 2m", "error": str(exc)}
