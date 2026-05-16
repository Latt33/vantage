"""GeoJSON builder helpers used by all services.

Every service should return data using these builders so the shape
of FeatureCollections is consistent across layers.
"""

from typing import Any


def feature(geometry: dict, properties: dict | None = None) -> dict:
    """Wrap a geometry dict in a GeoJSON Feature."""
    return {
        "type": "Feature",
        "geometry": geometry,
        "properties": properties or {},
    }


def feature_collection(features: list[dict], source: str | None = None) -> dict:
    """Wrap a list of Feature dicts in a GeoJSON FeatureCollection.

    Optionally attach a top-level 'source' key so the frontend can
    show which data provider produced each layer.
    """
    fc: dict[str, Any] = {
        "type": "FeatureCollection",
        "features": features,
    }
    if source:
        fc["source"] = source
    return fc


def point(lon: float, lat: float) -> dict:
    return {"type": "Point", "coordinates": [lon, lat]}


def line_string(coordinates: list[list[float]]) -> dict:
    return {"type": "LineString", "coordinates": coordinates}


def polygon(rings: list[list[list[float]]]) -> dict:
    """rings[0] is the exterior ring; rings[1:] are holes."""
    return {"type": "Polygon", "coordinates": rings}
