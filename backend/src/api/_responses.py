"""Shared response helpers for the per-feature routers.

Every typed router ultimately serves a file written by its sibling service module.
Three canonical storage formats are used (see _shared/formats.py for schemas):

  .geojson  — GeoJSON FeatureCollection, served as-is
  .parquet  — Parquet grid (lon, lat, variables); converted to GeoJSON on the fly
  .osm      — OSM XML; converted to GeoJSON on the fly with optional tag filtering

The helpers here centralise:
  - AOI existence check
  - Path-traversal guard
  - File-not-found handling (data may still be loading)
  - Format conversion and content-type assignment
"""

from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse, JSONResponse

from src.service._shared.formats import read_osm_as_geojson, read_parquet_as_geojson
from src.service._shared.storage import category_file, get_aoi_meta

_GEO_JSON_MEDIA = "application/geo+json"


def ensure_aoi(aoi_id: str) -> dict:
    meta = get_aoi_meta(aoi_id)
    if meta is None:
        raise HTTPException(status_code=404, detail="AoI not found")
    return meta


def _resolve_path(aoi_id: str, category: str, filename: str) -> Path:
    """Validate AoI existence and filename safety, return the resolved path."""
    ensure_aoi(aoi_id)
    if "/" in filename or "\\" in filename or filename.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = category_file(aoi_id, category, filename)
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail=(
                f"File '{filename}' not found in category '{category}' — "
                "data may still be loading"
            ),
        )
    return path


def serve_layer_file(aoi_id: str, category: str, filename: str) -> FileResponse | JSONResponse:
    """Serve any layer file, converting Parquet and OSM to GeoJSON automatically.

    .geojson  → FileResponse (application/geo+json)
    .parquet  → JSONResponse GeoJSON FeatureCollection (all columns as properties)
    .osm      → JSONResponse GeoJSON FeatureCollection (all tagged elements)
    other     → FileResponse (application/octet-stream)
    """
    path = _resolve_path(aoi_id, category, filename)
    suffix = path.suffix.lower()

    if suffix == ".geojson":
        return FileResponse(path, media_type=_GEO_JSON_MEDIA)

    if suffix == ".parquet":
        fc = read_parquet_as_geojson(path)
        return JSONResponse(fc, media_type=_GEO_JSON_MEDIA)

    if suffix == ".osm":
        fc = read_osm_as_geojson(path)
        return JSONResponse(fc, media_type=_GEO_JSON_MEDIA)

    return FileResponse(path, media_type="application/octet-stream")


def serve_parquet_as_geojson(
    aoi_id: str,
    category: str,
    filename: str,
    value_cols: list[str] | None = None,
) -> JSONResponse:
    """Serve a Parquet grid file as a GeoJSON FeatureCollection.

    value_cols: which columns to include as feature properties.
                Defaults to all non-coordinate columns.
    """
    path = _resolve_path(aoi_id, category, filename)
    fc = read_parquet_as_geojson(path, value_cols=value_cols)
    return JSONResponse(fc, media_type=_GEO_JSON_MEDIA)


def serve_osm_as_geojson(
    aoi_id: str,
    category: str,
    filename: str,
    tag_filter: dict | None = None,
    exclude_tags: dict | None = None,
) -> JSONResponse:
    """Serve an OSM XML file as a GeoJSON FeatureCollection.

    tag_filter:   AND filter — all key/value conditions must match.
                  e.g. {"highway": None} matches any road type.
                  e.g. {"amenity": "fuel"} matches only fuel stations.
    exclude_tags: OR exclusion — features matching any condition are dropped.
                  e.g. {"bridge": "yes"} removes bridge ways from a road query.
    """
    path = _resolve_path(aoi_id, category, filename)
    fc = read_osm_as_geojson(path, tag_filter=tag_filter, exclude_tags=exclude_tags)
    return JSONResponse(fc, media_type=_GEO_JSON_MEDIA)
