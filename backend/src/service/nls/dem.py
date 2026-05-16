"""Digital Elevation Model (DEM) from Maanmittauslaitos.

Fetches the 'korkeusmalli_10m' coverage from the NLS WCS API and saves
it as a GeoTIFF. 

Requires transforming the WGS84 Bounding Box to ETRS-TM35FIN (EPSG:3067)
since the NLS WCS strictly uses Finnish coordinates.

Output files:
    {aoi_id}/dem/elevation.tiff
    {aoi_id}/dem/meta.json
"""

import logging
import os
import httpx
from pyproj import Transformer

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.storage import (
    category_file,
    write_category_meta,
    ensure_dir,
)

logger = logging.getLogger(__name__)

_NLS_WCS_BASE = "https://avoin-karttakuva.maanmittauslaitos.fi/ortokuvat-ja-korkeusmallit/wcs/v2"
MML_API_KEY = os.getenv("MML_API_KEY", "")

# Transform WGS84 (lon/lat) to ETRS-TM35FIN (E/N)
_transformer = Transformer.from_crs("EPSG:4326", "EPSG:3067", always_xy=True)

async def fetch_dem(aoi_id: str, bbox: BBox) -> dict:
    """Fetch MML DEM (GeoTIFF) and write to disk."""
    
    # 1. Convert coords to EPSG:3067
    min_e, min_n = _transformer.transform(bbox.min_lon, bbox.min_lat)
    max_e, max_n = _transformer.transform(bbox.max_lon, bbox.max_lat)
    
    # 2. Build WCS request
    params = {
        "service": "WCS",
        "version": "2.0.1",
        "request": "GetCoverage",
        "coverageId": "korkeusmalli_2m",
        "subset": [
            f"E({min_e},{max_e})",
            f"N({min_n},{max_n})"
        ],
        "format": "image/tiff"
    }

    try:
        auth = (MML_API_KEY, "") if MML_API_KEY else None
        
        # WCS returns raw binary TIFF data
        resp = await client.get(_NLS_WCS_BASE, params=params, auth=auth)
        resp.raise_for_status()
        
        tiff_data = resp.content
        
        out_path = category_file(aoi_id, "dem", "elevation.tiff")
        ensure_dir(out_path.parent)
        
        with open(out_path, "wb") as f:
            f.write(tiff_data)

        logger.info("NLS DEM: Downloaded %d bytes → elevation.tiff", len(tiff_data))
        
        write_category_meta(
            aoi_id, "dem",
            source="NLS Finland — Korkeusmalli 10m",
            confidence="high",
            feature_counts={"bytes": len(tiff_data)},
        )
        return {"source": "NLS Finland — Korkeusmalli 10m", "bytes": len(tiff_data)}

    except Exception as exc:
        logger.warning("NLS DEM fetch error: %s", exc)
        write_category_meta(
            aoi_id, "dem",
            source="NLS Finland — Korkeusmalli 10m",
            confidence="low",
            feature_counts={},
        )
        return {"source": "NLS Finland — Korkeusmalli 10m", "error": str(exc)}
