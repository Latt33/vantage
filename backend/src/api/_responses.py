"""Shared response helpers for the per-feature routers.

Every typed router ultimately serves a file written by its service module.
This module centralises:
  - AOI existence checks
  - Path-traversal guards
  - File-not-found handling (data may still be loading)
  - Parquet  → GeoJSON conversion (serve_parquet_as_geojson)
  - OSM XML  → GeoJSON conversion (serve_osm_as_geojson)
  - Raw file pass-through          (serve_layer_file)
"""

from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse, JSONResponse

from src.service._shared.storage import category_file, get_aoi_meta


def ensure_aoi(aoi_id: str) -> dict:
    meta = get_aoi_meta(aoi_id)
    if meta is None:
        raise HTTPException(status_code=404, detail="AoI not found")
    return meta


def _resolve_file(aoi_id: str, category: str, filename: str) -> Path:
    ensure_aoi(aoi_id)
    if "/" in filename or "\\" in filename or filename.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = category_file(aoi_id, category, filename)
    if not path.exists():
        bundled_path = Path(__file__).resolve().parent.parent.parent / "data" / aoi_id / category / filename
        if bundled_path.exists():
            return bundled_path
        raise HTTPException(
            status_code=404,
            detail=(
                f"File '{filename}' not found in category '{category}' — "
                "data may still be loading"
            ),
        )
    return path


def serve_layer_file(aoi_id: str, category: str, filename: str) -> FileResponse:
    """Return a file as-is with content-type derived from extension."""
    path = _resolve_file(aoi_id, category, filename)
    suffix = path.suffix.lower()
    if suffix == ".geojson":
        media_type = "application/geo+json"
    elif suffix in (".tif", ".tiff"):
        media_type = "image/tiff"
    elif suffix in (".png", ".jpg", ".jpeg", ".webp"):
        # Common web image types served as-is
        if suffix == ".png":
            media_type = "image/png"
        elif suffix == ".webp":
            media_type = "image/webp"
        else:
            media_type = "image/jpeg"
    elif suffix == ".osm":
        media_type = "application/xml"
    else:
        media_type = "application/json"
    return FileResponse(path, media_type=media_type)


def serve_parquet_as_geojson(aoi_id: str, category: str, filename: str) -> JSONResponse:
    """Read a Parquet grid file and return it as a GeoJSON FeatureCollection.

    Each row becomes a Point Feature; all non-geometry columns go into
    properties.  Imported lazily so services that don't use Parquet don't
    pay the pandas import cost.
    """
    path = _resolve_file(aoi_id, category, filename)
    from src.service._shared.formats import read_parquet_as_geojson
    fc = read_parquet_as_geojson(path)
    return JSONResponse(content=fc, media_type="application/geo+json")


def serve_osm_as_geojson(
    aoi_id: str,
    category: str,
    filename: str,
    tag_filter: dict | None = None,
    exclude_tags: dict | None = None,
) -> JSONResponse:
    """Read an OSM XML file, filter by tags, and return a GeoJSON FeatureCollection.

    tag_filter:   {key: value | list[value] | None} — elements must satisfy all entries
    exclude_tags: {key: value | None} — elements matching any entry are dropped
    """
    path = _resolve_file(aoi_id, category, filename)
    from src.service._shared.formats import read_osm_as_geojson
    fc = read_osm_as_geojson(path, tag_filter=tag_filter, exclude_tags=exclude_tags)
    return JSONResponse(content=fc, media_type="application/geo+json")
