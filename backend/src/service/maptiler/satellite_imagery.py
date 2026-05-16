"""MapTiler satellite imagery overlay metadata.

This stage does not download imagery. It records the tiled raster overlay
configuration for the requested AoI so the frontend can attach the native
MapTiler satellite tileset directly in MapLibre.

Output files:
    {aoi_id}/satellite_imagery/overlay.json
    {aoi_id}/satellite_imagery/meta.json
"""

import logging
import os

from src.service._shared.bbox import BBox
from src.service._shared.storage import category_file, write_category_meta, write_json

logger = logging.getLogger(__name__)

_TILESET = "satellite-v2"


def _get_maptiler_key() -> str:
    return (
        os.getenv("MAPTILER_KEY", "")
        or os.getenv("MAPTILER_API_KEY", "")
        or os.getenv("VITE_MAPTILER_KEY", "")
    )


async def fetch_satellite_imagery(aoi_id: str, bbox: BBox) -> dict:
    """Write raster overlay metadata for the MapTiler satellite tileset."""
    maptiler_key = _get_maptiler_key()
    if not maptiler_key:
        raise RuntimeError("MapTiler API key not set")

    overlay = {
        "provider": "MapTiler Satellite",
        "tileset": _TILESET,
        "image_format": "jpg",
        "tile_size": 256,
        "minzoom": 0,
        "maxzoom": 20,
        "attribution": "MapTiler Satellite",
        "bbox": {
            "min_lon": bbox.min_lon,
            "min_lat": bbox.min_lat,
            "max_lon": bbox.max_lon,
            "max_lat": bbox.max_lat,
        },
    }
    write_json(category_file(aoi_id, "satellite_imagery", "overlay.json"), overlay)

    write_category_meta(
        aoi_id,
        "satellite_imagery",
        source="MapTiler Satellite",
        confidence="medium",
        feature_counts={"tile_layers": 1},
    )
    logger.info("MapTiler satellite imagery configured for AoI %s", aoi_id)
    return {"source": "MapTiler Satellite", "feature_counts": {"tile_layers": 1}}