"""Digital Elevation Model (DEM) from Maanmittauslaitos.

Fetches the 'korkeusmalli_2m' coverage from the NLS WCS API as a GeoTIFF,
converts it to a Parquet grid in WGS84 (EPSG:4326), and also generates a
cropped high-resolution PNG overlay for fast map rendering.

The WCS endpoint expects coordinates in ETRS-TM35FIN (EPSG:3067); we buffer
the requested bbox before the fetch, then reproject back to WGS84 and crop to
the original bbox before writing the image. The PNG keeps one pixel per sampled
height cell so it can be used directly as a raster layer.

Output files:
    {aoi_id}/dem/elevation.parquet   — lon, lat, elevation_m
    {aoi_id}/dem/elevation.png      — cropped raster overlay
    {aoi_id}/dem/elevation.tif      — raw GeoTIFF (EPSG:3067) for derivatives
    {aoi_id}/dem/meta.json
"""

import logging
import os

import httpx
import numpy as np
import pandas as pd
import rasterio
from rasterio.io import MemoryFile
from rasterio.transform import array_bounds
from rasterio.warp import Resampling, calculate_default_transform, reproject
from rasterio.windows import Window, from_bounds as window_from_bounds, transform as window_transform, intersection
from pyproj import Transformer
from PIL import Image

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
_MAX_WCS_PIXELS = 250_000  # NLS WCS rejects requests producing more pixels than this
_FETCH_BUFFER_METERS = 750.0

_DEM_COLORS: list[tuple[int, int, int]] = [
    (255, 255, 255),
    (255, 210, 180),
    (255, 160, 120),
    (230,  90,  60),
    (180,  30,  20),
    (100,   0,   0),
]


def _bbox_to_3067_bounds(bbox: BBox) -> tuple[float, float, float, float]:
    corners = [
        _to_3067.transform(bbox.min_lon, bbox.min_lat),
        _to_3067.transform(bbox.max_lon, bbox.min_lat),
        _to_3067.transform(bbox.max_lon, bbox.max_lat),
        _to_3067.transform(bbox.min_lon, bbox.max_lat),
    ]
    eastings = [p[0] for p in corners]
    northings = [p[1] for p in corners]
    return min(eastings), min(northings), max(eastings), max(northings)


def _expanded_3067_bounds(bbox: BBox) -> tuple[float, float, float, float]:
    min_e, min_n, max_e, max_n = _bbox_to_3067_bounds(bbox)
    return min_e - _FETCH_BUFFER_METERS, min_n - _FETCH_BUFFER_METERS, max_e + _FETCH_BUFFER_METERS, max_n + _FETCH_BUFFER_METERS


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
            # Border fill values from upstream tiles often arrive as zero.
            # Treat <= 0 m as nodata so outside-coverage cells don't pollute
            # percentiles/legends and dominate the rendered AOI.
            mask = mask & np.isfinite(elevs) & (elevs > 0)
            df = pd.DataFrame({
                "lon": lons[mask],
                "lat": lats[mask],
                "elevation_m": elevs[mask],
            })
            write_parquet_grid(out_path, df)
    return len(df)


def _tiff_to_png(tiff_bytes: bytes, bbox: BBox, out_path) -> tuple[int, int]:
    """Reproject a DEM GeoTIFF to WGS84, crop to the bbox, and colorize it."""
    with MemoryFile(tiff_bytes) as mem:
        with mem.open() as ds:
            band = ds.read(1).astype("float32")
            nodata = ds.nodata

            dst_transform, dst_width, dst_height = calculate_default_transform(
                ds.crs,
                "EPSG:4326",
                ds.width,
                ds.height,
                *ds.bounds,
            )

            dst = np.full((dst_height, dst_width), np.nan, dtype="float32")
            reproject(
                source=band,
                destination=dst,
                src_transform=ds.transform,
                src_crs=ds.crs,
                src_nodata=nodata,
                dst_transform=dst_transform,
                dst_crs="EPSG:4326",
                dst_nodata=np.nan,
                resampling=Resampling.nearest,
            )

            crop_window = window_from_bounds(
                bbox.min_lon,
                bbox.min_lat,
                bbox.max_lon,
                bbox.max_lat,
                dst_transform,
            ).round_offsets().round_lengths()
            crop_window = intersection(crop_window, Window(0, 0, dst_width, dst_height))

            row_start = int(crop_window.row_off)
            col_start = int(crop_window.col_off)
            row_stop = row_start + int(crop_window.height)
            col_stop = col_start + int(crop_window.width)
            cropped = dst[row_start:row_stop, col_start:col_stop]

            valid = np.isfinite(cropped)
            # Outside-country or uncovered border pixels frequently become 0;
            # mask them out so they render transparent instead of white.
            terrain_valid = valid & (cropped > 0)
            if not terrain_valid.any():
                terrain_valid = valid
            if not terrain_valid.any():
                image = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
                ensure_dir(out_path.parent)
                image.save(out_path)
                return image.size

            values = cropped[terrain_valid]
            low = float(np.percentile(values, 2))
            high = float(np.percentile(values, 98))
            if high <= low:
                high = low + 1.0

            normalized = np.clip((cropped - low) / (high - low), 0.0, 1.0)
            scaled = normalized * (len(_DEM_COLORS) - 1)
            lower = np.floor(scaled).astype(int)
            upper = np.clip(lower + 1, 0, len(_DEM_COLORS) - 1)
            frac = scaled - lower

            palette = np.asarray(_DEM_COLORS, dtype=np.float32)
            rgb = (palette[lower] * (1.0 - frac[..., None]) + palette[upper] * frac[..., None]).astype(np.uint8)

            rgba = np.zeros((cropped.shape[0], cropped.shape[1], 4), dtype=np.uint8)
            rgba[..., :3] = rgb
            rgba[..., 3] = np.where(terrain_valid, 220, 0).astype(np.uint8)

            image = Image.fromarray(rgba, mode="RGBA")
            ensure_dir(out_path.parent)
            image.save(out_path)
            return image.size


async def fetch_dem(aoi_id: str, bbox: BBox) -> dict:
    """Fetch NLS DEM, convert to Parquet, and write to disk."""
    min_e, min_n, max_e, max_n = _expanded_3067_bounds(bbox)

    # Compute a SCALEFACTOR so the native 2m grid never exceeds _MAX_WCS_PIXELS.
    # The NLS WCS rejects requests that would produce too large an output.
    native_e = (max_e - min_e) / 2.0
    native_n = (max_n - min_n) / 2.0
    scale = min(1.0, (_MAX_WCS_PIXELS / (native_e * native_n)) ** 0.5)
    scale = round(max(scale, 0.001), 6)

    # Build the query string manually: NLS WCS rejects percent-encoded parentheses
    # and commas in subset values, which httpx's params= dict would produce.
    qs = (
        f"service=WCS&version=2.0.1&request=GetCoverage"
        f"&coverageId=korkeusmalli_2m"
        f"&subset=E({min_e},{max_e})"
        f"&subset=N({min_n},{max_n})"
        f"&SCALEFACTOR={scale}"
        f"&format=image/tiff"
    )
    if MML_API_KEY:
        qs += f"&api-key={MML_API_KEY}"
    url = f"{_NLS_WCS_BASE}?{qs}"

    out_path = category_file(aoi_id, "dem", "elevation.parquet")
    image_path = category_file(aoi_id, "dem", "elevation.png")
    tiff_path = category_file(aoi_id, "dem", "elevation.tif")
    ensure_dir(out_path.parent)

    try:
        resp = await client.get(url)
        resp.raise_for_status()

        # Persist the raw GeoTIFF so derivatives (e.g. movement corridors)
        # can re-read the native 3067 grid without hitting NLS again.
        with open(tiff_path, "wb") as fh:
            fh.write(resp.content)

        n_points = _tiff_to_parquet(resp.content, out_path)
        image_size = _tiff_to_png(resp.content, bbox, image_path)
        logger.info("NLS DEM: %d points → elevation.parquet; image=%sx%s", n_points, image_size[0], image_size[1])

        write_category_meta(
            aoi_id, "dem",
            source="NLS Finland — Korkeusmalli 2m",
            confidence="high",
            feature_counts={"points": n_points, "image_pixels": image_size[0] * image_size[1]},
        )
        return {"source": "NLS Finland — Korkeusmalli 2m", "points": n_points, "image_pixels": image_size[0] * image_size[1]}

    except httpx.HTTPStatusError as exc:
        logger.warning(
            "NLS DEM fetch error: HTTP %s\nURL: %s\nBody: %s",
            exc.response.status_code, exc.request.url, exc.response.text[:500],
        )
        error_detail = f"HTTP {exc.response.status_code}"
    except Exception as exc:
        logger.warning("NLS DEM fetch error: %s: %s", type(exc).__name__, exc)
        error_detail = str(exc)

    write_category_meta(
        aoi_id, "dem",
        source="NLS Finland — Korkeusmalli 2m",
        confidence="low",
        feature_counts={},
    )
    return {"source": "NLS Finland — Korkeusmalli 2m", "error": error_detail}
