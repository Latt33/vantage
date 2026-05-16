"""OpenStreetMap infrastructure (roads, bridges, fuel stations, power, healthcare, water works).

Fetches using the Overpass API.

Output files:
    {aoi_id}/infrastructure/roads.geojson
    {aoi_id}/infrastructure/bridges.geojson
    {aoi_id}/infrastructure/fuel.geojson
    {aoi_id}/infrastructure/power.geojson
    {aoi_id}/infrastructure/healthcare.geojson
    {aoi_id}/infrastructure/water_works.geojson
    {aoi_id}/infrastructure/meta.json
"""

import logging

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.geojson import feature, feature_collection, point, line_string
from src.service._shared.storage import category_file, write_category_meta, write_json

logger = logging.getLogger(__name__)

_OVERPASS_URL = "https://overpass-api.de/api/interpreter"

async def fetch_infrastructure(aoi_id: str, bbox: BBox) -> dict:
    """Fetch various infrastructure elements from OSM Overpass."""
    # Overpass bbox: south,west,north,east
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
    
    features_counts = {
        "roads.geojson": 0, 
        "bridges.geojson": 0, 
        "fuel.geojson": 0,
        "power.geojson": 0,
        "healthcare.geojson": 0,
        "water_works.geojson": 0,
    }
    
    try:
        resp = await client.post(_OVERPASS_URL, data={"data": query})
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        logger.warning("OSM Overpass error: %s", exc)
        return {"source": "OpenStreetMap", "feature_counts": features_counts}
        
    elements = data.get("elements", [])
    
    node_map = {}
    for el in elements:
        if el["type"] == "node":
            node_map[el["id"]] = (el.get("lon"), el.get("lat"))
            
    roads = []
    bridges = []
    fuel = []
    power = []
    healthcare = []
    water_works = []
    
    for el in elements:
        tags = el.get("tags", {})
        if not tags:
            continue
            
        geom = None
        if el["type"] == "way":
            coords = []
            for nid in el.get("nodes", []):
                n_coords = node_map.get(nid)
                if n_coords and n_coords[0] is not None and n_coords[1] is not None:
                    coords.append([n_coords[0], n_coords[1]])
            if len(coords) >= 2:
                geom = line_string(coords)
        elif el["type"] == "node":
            lon, lat = node_map.get(el["id"], (0, 0))
            if lon is not None and lat is not None:
                geom = point(lon, lat)
                
        if not geom:
            continue
            
        feat = feature(geom, tags)
        
        if tags.get("amenity") == "fuel" and el["type"] == "node":
            fuel.append(feat)
            
        if tags.get("power"):
            power.append(feat)
            
        if tags.get("amenity") in ("hospital", "clinic", "doctors"):
            healthcare.append(feat)
            
        if tags.get("man_made") == "water_works":
            water_works.append(feat)

        if tags.get("highway"):
            is_bridge = tags.get("bridge") == "yes" or tags.get("highway") == "bridge"
            if is_bridge:
                bridges.append(feat)
            else:
                roads.append(feat)

    write_json(
        category_file(aoi_id, "infrastructure", "roads.geojson"),
        feature_collection(roads, source="OpenStreetMap")
    )
    write_json(
        category_file(aoi_id, "infrastructure", "bridges.geojson"),
        feature_collection(bridges, source="OpenStreetMap")
    )
    write_json(
        category_file(aoi_id, "infrastructure", "fuel.geojson"),
        feature_collection(fuel, source="OpenStreetMap")
    )
    write_json(
        category_file(aoi_id, "infrastructure", "power.geojson"),
        feature_collection(power, source="OpenStreetMap")
    )
    write_json(
        category_file(aoi_id, "infrastructure", "healthcare.geojson"),
        feature_collection(healthcare, source="OpenStreetMap")
    )
    write_json(
        category_file(aoi_id, "infrastructure", "water_works.geojson"),
        feature_collection(water_works, source="OpenStreetMap")
    )
    
    features_counts = {
        "roads.geojson": len(roads),
        "bridges.geojson": len(bridges),
        "fuel.geojson": len(fuel),
        "power.geojson": len(power),
        "healthcare.geojson": len(healthcare),
        "water_works.geojson": len(water_works),
    }
    
    logger.info("OSM infra: %d roads, %d bridges, %d fuel, %d power, %d healthcare, %d water_works → infrastructure/", 
                len(roads), len(bridges), len(fuel), len(power), len(healthcare), len(water_works))

    write_category_meta(
        aoi_id, "infrastructure",
        source="OpenStreetMap",
        confidence="high" if any(features_counts.values()) else "low",
        feature_counts=features_counts,
    )
    return {"source": "OpenStreetMap", "feature_counts": features_counts}
