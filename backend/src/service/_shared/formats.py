"""Canonical read/write functions for all service data formats.

Three canonical formats — pick using the decision tree in data_types.md:

1. Parquet grid (.parquet)  — continuous spatial fields (DEM, weather)
2. OSM XML     (.osm)       — OpenStreetMap data from Overpass API
3. GeoJSON     (.geojson)   — discrete points/polygons from other sources

All write functions enforce schema rules (column order, CRS, structure).
All read functions convert to GeoJSON FeatureCollection for the API layer.
"""

from __future__ import annotations

import json
from pathlib import Path
from xml.etree import ElementTree as ET

import pandas as pd

from src.service._shared.storage import ensure_dir


# ---------------------------------------------------------------------------
# Format 1: Parquet grid
# ---------------------------------------------------------------------------

def write_parquet_grid(path: Path, df: pd.DataFrame) -> None:
    """Write a spatial grid DataFrame as Parquet.

    Enforces lon/lat as the first two columns in float64.
    All other columns follow in the order they appear in df.
    """
    ensure_dir(path.parent)
    cols = ["lon", "lat"] + [c for c in df.columns if c not in ("lon", "lat")]
    out = df[cols].copy()
    out["lon"] = out["lon"].astype("float64")
    out["lat"] = out["lat"].astype("float64")
    out.to_parquet(path, index=False)


def read_parquet_as_geojson(path: Path) -> dict:
    """Read a Parquet grid and return a GeoJSON FeatureCollection.

    Each row becomes a Point Feature.  All non-geometry columns go into
    properties.  Numpy scalar types are converted to Python natives so the
    dict can be JSON-serialised by FastAPI.
    """
    df = pd.read_parquet(path)

    import math

    features = []
    for _, row in df.iterrows():
        props: dict = {}
        for k, v in row.items():
            if k in ("lon", "lat"):
                continue
            scalar = v.item() if hasattr(v, "item") else v
            props[k] = None if (isinstance(scalar, float) and math.isnan(scalar)) else scalar
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [row["lon"], row["lat"]]},
            "properties": props,
        })

    return {"type": "FeatureCollection", "features": features}


# ---------------------------------------------------------------------------
# Format 2: OSM XML
# ---------------------------------------------------------------------------

def write_osm(path: Path, elements: list[dict]) -> None:
    """Write Overpass API elements as standard OSM 0.6 XML.

    Both tagged elements and bare geometry nodes (needed to reconstruct
    way coordinates) are written verbatim.
    """
    ensure_dir(path.parent)

    root = ET.Element("osm", version="0.6", generator="AI2PB/overpass")

    for el in elements:
        el_type = el.get("type")
        if el_type == "node":
            node = ET.SubElement(
                root, "node",
                id=str(el["id"]),
                lat=str(el.get("lat", "")),
                lon=str(el.get("lon", "")),
            )
            for k, v in el.get("tags", {}).items():
                ET.SubElement(node, "tag", k=k, v=str(v))
        elif el_type == "way":
            way = ET.SubElement(root, "way", id=str(el["id"]))
            for nd_ref in el.get("nodes", []):
                ET.SubElement(way, "nd", ref=str(nd_ref))
            for k, v in el.get("tags", {}).items():
                ET.SubElement(way, "tag", k=k, v=str(v))

    ET.indent(root, space="  ")
    tree = ET.ElementTree(root)
    with open(path, "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        tree.write(f, encoding="unicode")


def read_osm_as_geojson(
    path: Path,
    tag_filter: dict | None = None,
    exclude_tags: dict | None = None,
) -> dict:
    """Read an OSM XML file and return a filtered GeoJSON FeatureCollection.

    tag_filter:   {key: value | list[value] | None}
                  Only elements whose tags satisfy ALL entries are included.
                  None as a value means "any value for this key".
    exclude_tags: {key: value | None}
                  Elements that match ANY entry are excluded.
    """
    tree = ET.parse(path)
    root = tree.getroot()

    # Build a node coordinate lookup keyed by OSM id.
    node_coords: dict[int, tuple[float, float]] = {}
    for node in root.findall("node"):
        nid = int(node.get("id", 0))
        lat_str = node.get("lat")
        lon_str = node.get("lon")
        if lat_str and lon_str:
            node_coords[nid] = (float(lat_str), float(lon_str))

    def _matches(tags: dict) -> bool:
        if not tag_filter:
            return True
        for key, val in tag_filter.items():
            if key not in tags:
                return False
            if val is None:
                continue
            if isinstance(val, list):
                if tags[key] not in val:
                    return False
            elif tags[key] != val:
                return False
        return True

    def _excluded(tags: dict) -> bool:
        if not exclude_tags:
            return False
        for key, val in exclude_tags.items():
            if key in tags and (val is None or tags[key] == val):
                return True
        return False

    features = []

    for node in root.findall("node"):
        tags = {t.get("k"): t.get("v") for t in node.findall("tag")}
        if not tags:
            continue
        if not _matches(tags):
            continue
        if _excluded(tags):
            continue
        lat_str = node.get("lat")
        lon_str = node.get("lon")
        if not lat_str or not lon_str:
            continue
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [float(lon_str), float(lat_str)],
            },
            "properties": tags,
        })

    for way in root.findall("way"):
        tags = {t.get("k"): t.get("v") for t in way.findall("tag")}
        if not _matches(tags):
            continue
        if _excluded(tags):
            continue
        refs = [int(nd.get("ref", 0)) for nd in way.findall("nd")]
        coords = [
            [node_coords[r][1], node_coords[r][0]]
            for r in refs
            if r in node_coords
        ]
        if len(coords) < 2:
            continue
        is_closed = coords[0] == coords[-1] and len(coords) >= 4
        geom: dict
        if is_closed:
            geom = {"type": "Polygon", "coordinates": [coords]}
        else:
            geom = {"type": "LineString", "coordinates": coords}
        features.append({
            "type": "Feature",
            "geometry": geom,
            "properties": tags,
        })

    return {"type": "FeatureCollection", "features": features}
