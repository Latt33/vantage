"""Infrastructure data from OpenStreetMap via the Overpass API.

Source:  https://www.openstreetmap.org
API:     https://overpass-api.de  (German-hosted, EU-neutral)

Fetches roads and bridges/fords separately and writes them to individual
GeoJSON files so the frontend can style and query them independently.

Output files:
    {aoi_id}/infrastructure/roads.geojson    — roads (LineStrings)
    {aoi_id}/infrastructure/bridges.geojson  — bridges and fords (Points + LineStrings)
    {aoi_id}/infrastructure/meta.json

Overpass bbox format is (south, west, north, east) = (min_lat, min_lon, max_lat, max_lon).
"""

import logging

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.geojson import feature_collection
from src.service._shared.storage import (
    category_file,
    write_category_meta,
    write_json,
)

logger = logging.getLogger(__name__)

_OVERPASS_URL = "https://overpass-api.de/api/interpreter"
_ROAD_CLASSES = "motorway|trunk|primary|secondary|tertiary|unclassified|track"

_QUERY_TEMPLATE = """
[out:json][timeout:30][bbox:{s},{w},{n},{e}];
(
  way["highway"~"^({roads})$"];
  way["bridge"="yes"];
  node["bridge"="yes"];
  way["ford"="yes"];
  node["ford"="yes"];
);
out body;
>;
out skel qt;
""".strip()


def _build_query(bbox: BBox) -> str:
    return _QUERY_TEMPLATE.format(
        s=bbox.min_lat, w=bbox.min_lon,
        n=bbox.max_lat, e=bbox.max_lon,
        roads=_ROAD_CLASSES,
    )


def _parse_elements(elements: list[dict]) -> tuple[list[dict], list[dict]]:
    """Split Overpass elements into road features and bridge/ford features.

    Returns (roads, bridges) as separate GeoJSON feature lists.
    """
    nodes: dict[int, tuple[float, float]] = {}
    ways: list[dict] = []

    for el in elements:
        if el["type"] == "node":
            nodes[el["id"]] = (el.get("lon", 0.0), el.get("lat", 0.0))
        elif el["type"] == "way":
            ways.append(el)

    roads: list[dict] = []
    bridges: list[dict] = []

    # Tagged standalone nodes (bridge/ford markers)
    for el in elements:
        if el["type"] != "node":
            continue
        tags = el.get("tags", {})
        if not tags:
            continue
        lon, lat = nodes.get(el["id"], (0.0, 0.0))
        feat = {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {**tags, "osm_id": el["id"], "osm_type": "node"},
        }
        if tags.get("bridge") == "yes" or tags.get("ford") == "yes":
            bridges.append(feat)

    # Ways
    for way in ways:
        coords = [nodes[nid] for nid in way.get("nodes", []) if nid in nodes]
        if len(coords) < 2:
            continue
        tags = way.get("tags", {})
        feat = {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {**tags, "osm_id": way["id"], "osm_type": "way"},
        }
        if tags.get("bridge") == "yes" or tags.get("ford") == "yes":
            bridges.append(feat)
        elif tags.get("highway"):
            roads.append(feat)

    return roads, bridges


async def fetch_infra(aoi_id: str, bbox: BBox) -> dict:
    """Fetch infrastructure features and write to disk. Returns a summary dict."""
    query = _build_query(bbox)

    try:
        resp = await client.post(_OVERPASS_URL, data={"data": query})
        resp.raise_for_status()
        elements = resp.json().get("elements", [])
        roads, bridges = _parse_elements(elements)

        write_json(
            category_file(aoi_id, "infrastructure", "roads.geojson"),
            feature_collection(roads, source="OpenStreetMap / Overpass API"),
        )
        write_json(
            category_file(aoi_id, "infrastructure", "bridges.geojson"),
            feature_collection(bridges, source="OpenStreetMap / Overpass API"),
        )

        counts = {"roads.geojson": len(roads), "bridges.geojson": len(bridges)}
        logger.info("OSM infra: %d roads, %d bridges → infrastructure/", len(roads), len(bridges))

        write_category_meta(
            aoi_id, "infrastructure",
            source="OpenStreetMap / Overpass API",
            confidence="medium",
            feature_counts=counts,
        )
        return {"source": "OpenStreetMap / Overpass API", "feature_counts": counts}

    except Exception as exc:
        logger.warning("OSM infra fetch failed: %s", exc)
        write_category_meta(
            aoi_id, "infrastructure",
            source="OpenStreetMap / Overpass API",
            confidence="low",
            feature_counts={},
        )
        return {"source": "OpenStreetMap / Overpass API", "error": str(exc)}
