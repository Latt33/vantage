"""Road weather camera stations from Fintraffic Digitraffic.

Source: https://www.digitraffic.fi/en/road-traffic/
API:    https://tie.digitraffic.fi/api/weathercam/v1/stations

Outputs:
    {aoi_id}/traffic_cameras/stations.geojson
    {aoi_id}/traffic_cameras/meta.json
"""

from __future__ import annotations

import logging

import httpx

from src.service._shared.bbox import BBox
from src.service._shared.client import client
from src.service._shared.geojson import feature_collection
from src.service._shared.storage import (
    category_file,
    write_category_meta,
    write_json,
)

logger = logging.getLogger(__name__)

_WEATHERCAM_URL = "https://tie.digitraffic.fi/api/weathercam/v1/stations"
_SOURCE_NAME = "Fintraffic / Digitraffic Weather Cameras"


def _in_bbox(coords: list[float], bbox: BBox) -> bool:
    if len(coords) < 2:
        return False
    lon, lat = coords[0], coords[1]
    return bbox.min_lon <= lon <= bbox.max_lon and bbox.min_lat <= lat <= bbox.max_lat


def _pick_preset(presets: list[dict]) -> dict | None:
    for preset in presets:
        if preset.get("inCollection") is True and preset.get("imageUrl"):
            return preset
    return presets[0] if presets else None


async def fetch_weathercam(aoi_id: str, bbox: BBox) -> dict:
    """Fetch Digitraffic weather camera stations and write GeoJSON to disk."""
    features: list[dict] = []

    try:
        resp = await client.get(_WEATHERCAM_URL)
        resp.raise_for_status()
        data = resp.json()

        for feature in data.get("features", []):
            geometry = feature.get("geometry") or {}
            if geometry.get("type") != "Point":
                continue
            coords = geometry.get("coordinates", [])
            if not _in_bbox(coords, bbox):
                continue

            props = feature.get("properties", {}) or {}
            presets = props.get("presets", []) or []
            preset = _pick_preset(presets)
            if not preset:
                continue

            if props.get("collectionStatus") not in ("GATHERING", "COLLECTING", None):
                continue

            feature_props = {
                "station_id": props.get("id"),
                "name": props.get("names", {}).get("fi") or props.get("name"),
                "municipality": props.get("municipality"),
                "province": props.get("province"),
                "road_number": (props.get("roadAddress") or {}).get("roadNumber"),
                "collection_status": props.get("collectionStatus"),
                "updated_at": props.get("dataUpdatedTime"),
                "preset_id": preset.get("id"),
                "image_url": preset.get("imageUrl"),
                "image_thumb_url": f"{preset.get('imageUrl')}?thumbnail=true" if preset.get("imageUrl") else None,
            }

            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": coords[:2]},
                "properties": feature_props,
            })

    except httpx.HTTPStatusError as exc:
        logger.warning("Digitraffic weathercam HTTP %s", exc.response.status_code)
    except Exception as exc:
        logger.warning("Digitraffic weathercam error: %s", exc)

    write_json(
        category_file(aoi_id, "traffic_cameras", "stations.geojson"),
        feature_collection(features, source=_SOURCE_NAME),
    )

    counts = {"stations.geojson": len(features)}
    write_category_meta(
        aoi_id,
        "traffic_cameras",
        source=_SOURCE_NAME,
        confidence="high" if features else "low",
        feature_counts=counts,
    )

    logger.info("Digitraffic weathercam: %d stations", len(features))
    return {"source": _SOURCE_NAME, "feature_counts": counts}
