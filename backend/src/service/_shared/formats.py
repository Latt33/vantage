"""Canonical storage format utilities for AI2PB.

Three storage formats are used across all services:

  Parquet grid (.parquet)
      Spatiotemporal grids — DEM elevation, weather forecast.
      Schema: lon (float64), lat (float64), [variable columns...]
      CRS: WGS84 (EPSG:4326). No other CRS is permitted.

  GeoJSON FeatureCollection (.geojson)
      Discrete point, polygon, and line features from any non-OSM source.
      Also used for point features from OSM (e.g., fuel stations, cameras).
      Geometry in EPSG:4326. Every feature must have "source" in properties.

  OSM XML (.osm)
      Data fetched from OpenStreetMap / Overpass API.
      Standard OSM 0.6 format, preserving original node/way IDs and all tags.
      One file per service category (e.g., infrastructure/infra.osm).

The API layer always converts Parquet and OSM to GeoJSON before sending to
the frontend. The frontend never reads Parquet or .osm files directly.

Adding a new service — choose format by answering:
  Is it a continuous spatial field (elevation, wind speed over a grid)?  → Parquet
  Did it come from OpenStreetMap / Overpass (ways, nodes with OSM IDs)?  → OSM XML
  Is it discrete points, polygons, or lines from any other source?       → GeoJSON
"""

import xml.etree.ElementTree as ET
from pathlib import Path

import pandas as pd

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

GRID_CRS = "EPSG:4326"  # mandatory CRS for all Parquet grid files

# ---------------------------------------------------------------------------
# Parquet grid
# ---------------------------------------------------------------------------


def write_parquet_grid(path: Path, df: pd.DataFrame) -> None:
    """Write a spatial grid DataFrame as Parquet.

    Raises ValueError if 'lon' or 'lat' columns are missing.
    Column order is enforced: lon, lat come first.
    """
    if "lon" not in df.columns or "lat" not in df.columns:
        raise ValueError("Parquet grid DataFrame must contain 'lon' and 'lat' columns")
    other = [c for c in df.columns if c not in ("lon", "lat")]
    df = df[["lon", "lat"] + other]
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(path, index=False, engine="pyarrow")


def read_parquet_as_geojson(
    path: Path,
    value_cols: list[str] | None = None,
) -> dict:
    """Read a Parquet grid and return a GeoJSON FeatureCollection.

    Each row becomes a GeoJSON Point feature at (lon, lat).
    If value_cols is None, all non-coordinate columns are included as properties.
    """
    df = pd.read_parquet(path, engine="pyarrow")
    if value_cols is None:
        value_cols = [c for c in df.columns if c not in ("lon", "lat")]

    features = []
    for row in df.itertuples(index=False):
        lon = float(row.lon)
        lat = float(row.lat)
        # Convert numpy/pandas scalar types to Python native for JSON serialisation
        props = {
            col: (getattr(row, col).item() if hasattr(getattr(row, col), "item") else getattr(row, col))
            for col in value_cols
        }
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": props,
        })

    return {"type": "FeatureCollection", "features": features}


# ---------------------------------------------------------------------------
# OSM XML
# ---------------------------------------------------------------------------


def write_osm(path: Path, elements: list[dict]) -> None:
    """Write Overpass API elements as a standard OSM 0.6 XML file.

    Preserves original OSM node/way IDs and all tags verbatim.
    Both tagged elements and bare geometry nodes (needed for way reconstruction)
    are written so read_osm_as_geojson can rebuild way coordinates.
    """
    root = ET.Element("osm", attrib={"version": "0.6", "generator": "AI2PB/overpass"})

    for el in elements:
        el_type = el.get("type")
        el_id = str(el.get("id", ""))
        tags = el.get("tags", {})

        if el_type == "node":
            node_el = ET.SubElement(root, "node", attrib={
                "id": el_id,
                "lat": str(el.get("lat", "")),
                "lon": str(el.get("lon", "")),
            })
            for k, v in tags.items():
                ET.SubElement(node_el, "tag", attrib={"k": k, "v": str(v)})

        elif el_type == "way":
            way_el = ET.SubElement(root, "way", attrib={"id": el_id})
            for node_ref in el.get("nodes", []):
                ET.SubElement(way_el, "nd", attrib={"ref": str(node_ref)})
            for k, v in tags.items():
                ET.SubElement(way_el, "tag", attrib={"k": k, "v": str(v)})

    path.parent.mkdir(parents=True, exist_ok=True)
    tree = ET.ElementTree(root)
    ET.indent(tree, space="  ")
    tree.write(str(path), encoding="UTF-8", xml_declaration=True)


def _tag_matches(tags: dict, tag_filter: dict) -> bool:
    """AND match: every key/value condition in tag_filter must be satisfied.

    Value rules:
      None      → key must exist, any value accepted
      str       → key must equal this string
      list[str] → key must be one of the listed strings
    """
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


def _tag_excluded(tags: dict, exclude_tags: dict) -> bool:
    """OR exclusion: return True if ANY condition in exclude_tags is matched."""
    for key, val in exclude_tags.items():
        if key not in tags:
            continue
        if val is None:
            return True
        if isinstance(val, list):
            if tags[key] in val:
                return True
        elif tags[key] == val:
            return True
    return False


def read_osm_as_geojson(
    path: Path,
    tag_filter: dict | None = None,
    exclude_tags: dict | None = None,
) -> dict:
    """Read an OSM XML file and return a GeoJSON FeatureCollection.

    Nodes with tags  → Point features.
    Ways with tags   → LineString features (coordinates from node references).
    Bare nodes (no tags) are used only for way geometry — never become features.

    tag_filter:   AND filter — all conditions must match (see _tag_matches).
    exclude_tags: OR exclusion — feature is dropped if any condition matches.

    Properties on every feature:
      source    "OpenStreetMap"
      osm_id    original OSM element ID (int)
      osm_type  "node" | "way"
      + all OSM tags verbatim
    """
    tree = ET.parse(str(path))
    root = tree.getroot()

    # Build node coordinate lookup — includes bare geometry nodes
    node_coords: dict[int, tuple[float, float]] = {}
    for node_el in root.findall("node"):
        lat_str = node_el.get("lat")
        lon_str = node_el.get("lon")
        if lat_str and lon_str:
            node_coords[int(node_el.get("id"))] = (float(lon_str), float(lat_str))

    features = []

    for node_el in root.findall("node"):
        tags = {t.get("k"): t.get("v") for t in node_el.findall("tag")}
        if not tags:
            continue
        if tag_filter and not _tag_matches(tags, tag_filter):
            continue
        if exclude_tags and _tag_excluded(tags, exclude_tags):
            continue
        nid = int(node_el.get("id"))
        if nid not in node_coords:
            continue
        lon, lat = node_coords[nid]
        props = dict(tags)
        props.update({"source": "OpenStreetMap", "osm_id": nid, "osm_type": "node"})
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": props,
        })

    for way_el in root.findall("way"):
        tags = {t.get("k"): t.get("v") for t in way_el.findall("tag")}
        if not tags:
            continue
        if tag_filter and not _tag_matches(tags, tag_filter):
            continue
        if exclude_tags and _tag_excluded(tags, exclude_tags):
            continue
        coords = [
            list(node_coords[int(nd.get("ref"))])
            for nd in way_el.findall("nd")
            if int(nd.get("ref")) in node_coords
        ]
        if len(coords) < 2:
            continue
        wid = int(way_el.get("id"))
        props = dict(tags)
        props.update({"source": "OpenStreetMap", "osm_id": wid, "osm_type": "way"})
        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": props,
        })

    return {"type": "FeatureCollection", "features": features}
