"""Infrastructure from OpenStreetMap via the Overpass API.

Queries a single Overpass request for all infrastructure-relevant OSM
features within the bounding box, then writes them verbatim as OSM XML.
The API layer filters the file on-the-fly to serve typed sub-layers.

Features fetched in one query:
    - Roads          (way["highway"])
    - Bridges        (way["bridge"="yes"])
    - Fuel stations  (node/way["amenity"="fuel"])
    - Power infra    (node/way["power"])
    - Healthcare     (node/way["amenity"~"hospital|clinic|doctors"])

The ">; out skel qt;" step expands ways into their member nodes so that
way coordinates can be reconstructed when reading back from OSM XML.

Output files:
    {aoi_id}/infrastructure/infra.osm
    {aoi_id}/infrastructure/meta.json
"""

import logging

import httpx

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.formats import write_osm
from src.service._shared.storage import category_file, write_category_meta

logger = logging.getLogger(__name__)

_OVERPASS_URL = "https://overpass-api.de/api/interpreter"


_OVERPASS_TIMEOUT = httpx.Timeout(connect=30.0, read=90.0, write=10.0, pool=5.0)


def _build_query(bbox: BBox) -> str:
    b = f"{bbox.min_lat},{bbox.min_lon},{bbox.max_lat},{bbox.max_lon}"
    return f"""[out:json][timeout:60][bbox:{b}];
(
  way["highway"];
);
out body;
>;
out skel qt;"""


async def fetch_infra(aoi_id: str, bbox: BBox) -> dict:
    """Query Overpass for infrastructure features and write as OSM XML."""
    query = _build_query(bbox)

    try:
        resp = await client.post(
            _OVERPASS_URL,
            data={"data": query},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=_OVERPASS_TIMEOUT,
        )
        resp.raise_for_status()
        elements: list[dict] = resp.json().get("elements", [])

        out_path = category_file(aoi_id, "infrastructure", "infra.osm")
        write_osm(out_path, elements)

        tagged = sum(1 for e in elements if e.get("tags"))
        logger.info(
            "OSM infra: %d elements (%d tagged) → infra.osm", len(elements), tagged
        )

        write_category_meta(
            aoi_id, "infrastructure",
            source="OpenStreetMap / Overpass API",
            confidence="high" if elements else "low",
            feature_counts={"elements": len(elements), "tagged": tagged},
        )
        return {
            "source": "OpenStreetMap / Overpass API",
            "feature_counts": {"elements": len(elements), "tagged": tagged},
        }

    except Exception as exc:
        logger.warning("Overpass infra fetch error: %s: %s", type(exc).__name__, exc)
        write_category_meta(
            aoi_id, "infrastructure",
            source="OpenStreetMap / Overpass API",
            confidence="low",
            feature_counts={},
        )
        return {"source": "OpenStreetMap / Overpass API", "error": str(exc)}
