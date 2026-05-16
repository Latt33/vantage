"""Shared response helpers for the per-feature routers.

Every typed router (weather, water, land, …) ultimately serves a file written
by its sibling service module. `serve_layer_file` centralises:
  - AOI existence check
  - Path-traversal guard
  - File-not-found handling (data may still be loading)
  - Content-type derivation from file extension
"""

from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse

from src.service._shared.storage import category_file, get_aoi_meta


def ensure_aoi(aoi_id: str) -> dict:
    meta = get_aoi_meta(aoi_id)
    if meta is None:
        raise HTTPException(status_code=404, detail="AoI not found")
    return meta


def serve_layer_file(aoi_id: str, category: str, filename: str) -> FileResponse:
    ensure_aoi(aoi_id)

    if "/" in filename or "\\" in filename or filename.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid filename")

    path: Path = category_file(aoi_id, category, filename)
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail=(
                f"File '{filename}' not found in category '{category}' — "
                "data may still be loading"
            ),
        )

    suffix = path.suffix.lower()
    if suffix == ".geojson":
        media_type = "application/geo+json"
    elif suffix in (".tif", ".tiff"):
        media_type = "image/tiff"
    else:
        media_type = "application/json"

    return FileResponse(path, media_type=media_type)
