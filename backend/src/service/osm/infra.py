"""OpenStreetMap infrastructure (roads, bridges, fuel, power, healthcare, water works).

Fetches using the Overpass API and saves the raw elements as a single OSM XML
file, preserving all node/way IDs and tags for full fidelity.

The API layer converts infra.osm → GeoJSON on the fly, filtering by tag type
for each sub-layer endpoint (roads, bridges, fuel, etc.).

Output files:
    {aoi_id}/infrastructure/infra.osm   — OSM 0.6 XML, all elements
    {aoi_id}/infrastructure/meta.json
"""

import logging

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.formats import write_osm
from src.service._shared.storage import category_file, write_category_meta

logger = logging.getLogger(__name__)

_OVERPASS_URL = "https://overpass-api.de/api/interpreter"


async def fetch_infrastructure(aoi_id: str, bbox: BBox) -> dict:
    """Fetch OSM infrastructure via Overpass and write a single infra.osm file."""
    overpass_bbox = f"{bbox.min_lat},{bbox.min_lon},{bbox.max_lat},{bbox.max_lon}"

    query = f"""
    [out:json][timeout:90];
    (
      way["highway"]({overpass_bbox});
      node["highway"="bridge"]({overpass_bbox});
      way["highway"="bridge"]({overpass_bbox});
      node["amenity"="fuel"]({overpass_bbox});
      node["power"]({overpass_bbox});
      way["power"]({overpass_bbox});
      node["amenity"~"hospital|clinic|doctors"]({overpass_bbox});
      way["amenity"~"hospital|clinic|doctors"]({overpass_bbox});
      node["man_made"="water_works"]({overpass_bbox});
      way["man_made"="water_works"]({overpass_bbox});
    );
    out body;
    >;
    out skel qt;
    """

    resp = await client.post(_OVERPASS_URL, data={"data": query})
    resp.raise_for_status()
    data = resp.json()

    elements = data.get("elements", [])
    out_path = category_file(aoi_id, "infrastructure", "infra.osm")
    write_osm(out_path, elements)

    # Count only tagged elements for the summary (bare geometry nodes are excluded)
    tagged_count = sum(1 for el in elements if el.get("tags"))
    logger.info(
        "OSM infra: %d total elements (%d tagged) → infra.osm",
        len(elements), tagged_count,
    )

    write_category_meta(
        aoi_id, "infrastructure",
        source="OpenStreetMap",
        confidence="high" if tagged_count > 0 else "low",
        feature_counts={"infra.osm": tagged_count},
    )
    return {"source": "OpenStreetMap", "feature_counts": {"infra.osm": tagged_count}}
