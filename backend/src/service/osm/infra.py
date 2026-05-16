"""Infrastructure data from OpenStreetMap via the Overpass API.

Source:  https://www.openstreetmap.org
API:     https://overpass-api.de  (German-hosted, EU-neutral)

Fetches roads, waterways, and bridges for the given bounding box.
Only major road classes are included to keep response sizes manageable.

Overpass bbox format is (south, west, north, east) = (min_lat, min_lon, max_lat, max_lon).
"""

import logging

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.geojson import feature_collection

logger = logging.getLogger(__name__)

_OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Road classes worth including for mobility analysis.
_ROAD_CLASSES = "motorway|trunk|primary|secondary|tertiary|unclassified|track"

# Overpass QL template. Timeout is set conservatively for demo use.
_QUERY_TEMPLATE = """
[out:json][timeout:30][bbox:{s},{w},{n},{e}];
(
  way["highway"~"^({roads})$"];
  way["waterway"~"^(river|stream|canal|ditch)$"];
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
        s=bbox.min_lat,
        w=bbox.min_lon,
        n=bbox.max_lat,
        e=bbox.max_lon,
        roads=_ROAD_CLASSES,
    )


def _osm_elements_to_features(elements: list[dict]) -> list[dict]:
    """Convert Overpass JSON elements to GeoJSON features.

    Overpass returns nodes and ways separately. Ways reference node IDs
    for their geometry. We build a node lookup first, then resolve ways.
    """
    nodes: dict[int, tuple[float, float]] = {}
    ways: list[dict] = []

    for el in elements:
        if el["type"] == "node":
            nodes[el["id"]] = (el.get("lon", 0.0), el.get("lat", 0.0))
        elif el["type"] == "way":
            ways.append(el)

    features: list[dict] = []

    # Point features from standalone tagged nodes
    for el in elements:
        if el["type"] != "node":
            continue
        tags = el.get("tags", {})
        if not tags:
            continue
        lon, lat = nodes.get(el["id"], (0.0, 0.0))
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {**tags, "osm_id": el["id"], "osm_type": "node"},
        })

    # LineString features from ways
    for way in ways:
        coords = [nodes[nid] for nid in way.get("nodes", []) if nid in nodes]
        if len(coords) < 2:
            continue
        tags = way.get("tags", {})
        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {**tags, "osm_id": way["id"], "osm_type": "way"},
        })

    return features


async def fetch_infra(bbox: BBox) -> dict:
    """Return a GeoJSON FeatureCollection of infrastructure features."""
    query = _build_query(bbox)

    try:
        resp = await client.post(_OVERPASS_URL, data={"data": query})
        resp.raise_for_status()
        elements = resp.json().get("elements", [])
        features = _osm_elements_to_features(elements)
        logger.info("OSM infra: %d features for bbox %s", len(features), bbox)
        fc = feature_collection(features, source="OpenStreetMap / Overpass API")
        fc["confidence"] = "medium"  # OSM completeness varies by area
        return fc

    except Exception as exc:
        logger.warning("OSM infra fetch failed: %s", exc)
        return {
            "type": "FeatureCollection",
            "features": [],
            "source": "OpenStreetMap / Overpass API",
            "confidence": "low",
            "status": "error",
            "error": str(exc),
        }
