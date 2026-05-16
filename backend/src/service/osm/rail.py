"""Rail infrastructure from OpenStreetMap via the Overpass API.

This is the fallback rail source used when a Finnish rail-specific dataset is
not available. OSM is neutral community data and covers railway tracks,
yards, and junctions well enough for the map view.

Output files:
    {aoi_id}/rail/rail.osm
    {aoi_id}/rail/meta.json
"""

import logging
import math

import httpx

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.formats import write_osm
from src.service._shared.storage import category_file, write_category_meta

logger = logging.getLogger(__name__)

_OVERPASS_URL = "https://overpass-api.de/api/interpreter"
_OVERPASS_TIMEOUT = httpx.Timeout(connect=30.0, read=90.0, write=10.0, pool=5.0)


def _bbox_from_parts(bbox: BBox) -> list[BBox]:
    mid_lon = (bbox.min_lon + bbox.max_lon) / 2
    mid_lat = (bbox.min_lat + bbox.max_lat) / 2
    return [
        BBox(bbox.min_lon, bbox.min_lat, mid_lon, mid_lat),
        BBox(mid_lon, bbox.min_lat, bbox.max_lon, mid_lat),
        BBox(bbox.min_lon, mid_lat, mid_lon, bbox.max_lat),
        BBox(mid_lon, mid_lat, bbox.max_lon, bbox.max_lat),
    ]


async def _fetch_railway_features(bbox: BBox, depth: int = 0) -> list[dict]:
    b = f"{bbox.min_lat},{bbox.min_lon},{bbox.max_lat},{bbox.max_lon}"
    query = f"""[out:json][timeout:60][bbox:{b}];
(
  way["railway"];
);
out body;
>;
out skel qt;"""

    resp = await client.post(
        _OVERPASS_URL,
        data={"data": query},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=_OVERPASS_TIMEOUT,
    )
    resp.raise_for_status()
    elements: list[dict] = resp.json().get("elements", [])

    if len(elements) >= 2000 and depth < 3:
        merged: list[dict] = []
        for part in _bbox_from_parts(bbox):
            merged.extend(await _fetch_railway_features(part, depth + 1))
        return merged

    return elements


async def fetch_rail(aoi_id: str, bbox: BBox) -> dict:
    """Fetch railway geometry from OpenStreetMap and write it as OSM XML."""
    try:
        elements = await _fetch_railway_features(bbox)

        out_path = category_file(aoi_id, "rail", "rail.osm")
        write_osm(out_path, elements)

        tagged = sum(1 for e in elements if e.get("tags"))
        logger.info("OSM rail: %d elements (%d tagged) → rail.osm", len(elements), tagged)

        write_category_meta(
            aoi_id, "rail",
            source="OpenStreetMap / Overpass API",
            confidence="high" if elements else "low",
            feature_counts={"elements": len(elements), "tagged": tagged},
        )
        return {"source": "OpenStreetMap / Overpass API", "feature_counts": {"elements": len(elements), "tagged": tagged}}

    except Exception as exc:
        logger.warning("Overpass rail fetch error: %s: %s", type(exc).__name__, exc)
        category_file(aoi_id, "rail", "rail.osm").unlink(missing_ok=True)
        write_category_meta(
            aoi_id, "rail",
            source="OpenStreetMap / Overpass API",
            confidence="low",
            feature_counts={},
        )
        raise RuntimeError(str(exc)) from exc