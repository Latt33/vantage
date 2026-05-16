"""CelesTrak TLE fetcher + SGP4 satellite trajectory predictor.

Fetches Two-Line Element sets from CelesTrak's GP catalogue, propagates each
orbit using SGP4 at 5-minute intervals for 24 hours, converts TEME positions
to geodetic (lat/lon/alt), and returns ground-track features whose closest
approach to the AoI centre is ≤ PASS_RADIUS_KM.

Output:
    One GeoJSON FeatureCollection with:
    - A MultiLineString Feature per satellite (the ground track, antimeridian-split)
    - A Point Feature per 1-minute overpass moment (distance ≤ PASS_RADIUS_KM)
"""

import asyncio
import datetime
import logging
import math
from typing import Any

from src.service._shared.bbox import BBox
from src.service._shared.client import client

logger = logging.getLogger(__name__)

# gp.php was retired; the current API uses path-based URLs
CELESTRAK_GROUP_URL = "https://celestrak.org/SPACETRACK/query/GP/GROUP/{group}/FORMAT/json"

# NORAD IDs per capability-filter id (matches frontend capabilities.ts)
CONSTELLATION_SATS: dict[str, dict[str, str]] = {
    "sentinel_1": {
        "39634": "Sentinel-1A",
        "62048": "Sentinel-1C",
    },
    "sentinel_2": {
        "40697": "Sentinel-2A",
        "42063": "Sentinel-2B",
        "60079": "Sentinel-2C",
    },
    "landsat_9": {
        "49044": "Landsat 9",
    },
    "iceye_x": {
        "46497": "ICEYE-X4",
        "47951": "ICEYE-X5",
        "48918": "ICEYE-X6",
    },
    "planet_skysat": {
        "43797": "SkySat-7",
        "43798": "SkySat-8",
        "43800": "SkySat-9",
    },
}

# CelesTrak group name → set of NORAD IDs we want from that group.
# One HTTP request per group instead of one per satellite.
_GROUP_NORAD: dict[str, set[str]] = {
    "sentinel":  {"39634", "62048", "40697", "42063", "60079"},
    "landsat":   {"49044"},
    "iceye":     {"46497", "47951", "48918"},
    "planet":    {"43797", "43798", "43800"},
}

PASS_RADIUS_KM = 500.0
TRACK_HOURS = 72
TRACK_STEP_S = 300    # 5-minute ground track resolution
OVERPASS_STEP_S = 60  # 1-minute resolution for close-approach points

# WGS-84 constants (km)
_A = 6378.137
_F = 1 / 298.257223563
_B = _A * (1 - _F)
_E2 = 1 - (_B / _A) ** 2


# ---------------------------------------------------------------------------
# Coordinate maths
# ---------------------------------------------------------------------------

def _gmst_rad(dt: datetime.datetime) -> float:
    """Approximate Greenwich Mean Sidereal Time in radians."""
    j2000 = datetime.datetime(2000, 1, 1, 12, 0, 0, tzinfo=datetime.timezone.utc)
    d = (dt - j2000).total_seconds() / 86400.0
    t = d / 36525.0
    gmst_deg = 280.46061837 + 360.98564736629 * d + 0.000387933 * t * t
    return math.radians(gmst_deg % 360)


def _teme_to_ecef(
    r: tuple[float, float, float], dt: datetime.datetime
) -> tuple[float, float, float]:
    theta = _gmst_rad(dt)
    c, s = math.cos(theta), math.sin(theta)
    return r[0] * c + r[1] * s, -r[0] * s + r[1] * c, r[2]


def _ecef_to_geodetic(x: float, y: float, z: float) -> tuple[float, float, float]:
    """ECEF km → (lat_deg, lon_deg, alt_km)."""
    lon = math.atan2(y, x)
    p = math.hypot(x, y)
    lat = math.atan2(z, p * (1 - _E2))
    for _ in range(10):
        sin_lat = math.sin(lat)
        N = _A / math.sqrt(max(1 - _E2 * sin_lat * sin_lat, 1e-12))
        lat_new = math.atan2(z + _E2 * N * sin_lat, p)
        if abs(lat_new - lat) < 1e-12:
            break
        lat = lat_new
    sin_lat, cos_lat = math.sin(lat), math.cos(lat)
    N = _A / math.sqrt(max(1 - _E2 * sin_lat * sin_lat, 1e-12))
    alt = (p / cos_lat - N) if abs(cos_lat) > 1e-9 else (abs(z) / abs(sin_lat) - N * (1 - _E2))
    return math.degrees(lat), math.degrees(lon), alt


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return 2 * R * math.asin(math.sqrt(max(0.0, min(1.0, a))))


def _split_antimeridian(coords: list[list[float]]) -> list[list[list[float]]]:
    """Split a coordinate list into segments at antimeridian crossings."""
    if not coords:
        return []
    segments: list[list[list[float]]] = [[coords[0]]]
    for pt in coords[1:]:
        if abs(pt[0] - segments[-1][-1][0]) > 180:
            segments.append([pt])
        else:
            segments[-1].append(pt)
    return [s for s in segments if len(s) >= 2]


# ---------------------------------------------------------------------------
# TLE fetch
# ---------------------------------------------------------------------------

async def _fetch_group(group: str, wanted: set[str]) -> dict[str, tuple[str, str]]:
    """Fetch all TLEs for a CelesTrak group, return only the NORAD IDs in `wanted`."""
    url = CELESTRAK_GROUP_URL.format(group=group)
    try:
        resp = await client.get(url, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        result: dict[str, tuple[str, str]] = {}
        for entry in data:
            catnr = str(entry.get("NORAD_CAT_ID", ""))
            if catnr in wanted and "TLE_LINE1" in entry and "TLE_LINE2" in entry:
                result[catnr] = (entry["TLE_LINE1"], entry["TLE_LINE2"])
        logger.info("CelesTrak group '%s': %d/%d TLEs resolved", group, len(result), len(wanted))
        return result
    except Exception as exc:
        logger.warning("CelesTrak group '%s' fetch failed: %s", group, exc)
        return {}


async def _fetch_tles(norad_ids: list[str]) -> dict[str, tuple[str, str]]:
    """Fetch TLE lines for all NORAD IDs via group bulk requests."""
    if not norad_ids:
        return {}
    wanted_set = set(norad_ids)
    results = await asyncio.gather(*[
        _fetch_group(group, wanted & wanted_set)
        for group, wanted in _GROUP_NORAD.items()
        if wanted & wanted_set
    ])
    merged: dict[str, tuple[str, str]] = {}
    for r in results:
        merged.update(r)
    return merged


# ---------------------------------------------------------------------------
# Propagation
# ---------------------------------------------------------------------------

def _propagate(
    tle1: str, tle2: str, start: datetime.datetime, step_s: int, total_s: int
) -> list[dict[str, Any]]:
    """Propagate satellite, return list of {ts, lat, lon, alt_km}."""
    try:
        from sgp4.api import Satrec, jday  # type: ignore[import]
    except ImportError:
        logger.error("sgp4 package not installed — cannot propagate")
        return []

    sat = Satrec.twoline2rv(tle1, tle2)
    track: list[dict[str, Any]] = []
    steps = total_s // step_s
    for i in range(steps):
        dt = start + datetime.timedelta(seconds=i * step_s)
        jd, fr = jday(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second)
        e, r, _ = sat.sgp4(jd, fr)
        if e != 0:
            continue
        x, y, z = _teme_to_ecef((r[0], r[1], r[2]), dt)
        lat, lon, alt = _ecef_to_geodetic(x, y, z)
        track.append({"ts": dt.isoformat(), "lat": lat, "lon": lon, "alt_km": round(alt, 1)})
    return track


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def compute_trajectories(bbox: BBox) -> dict:
    """Return a GeoJSON FeatureCollection of satellite ground tracks.

    Includes only satellites whose track passes within PASS_RADIUS_KM of the
    AoI centre in the next TRACK_HOURS hours.
    """
    center_lat = (bbox.min_lat + bbox.max_lat) / 2.0
    center_lon = (bbox.min_lon + bbox.max_lon) / 2.0
    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)

    # Gather all NORAD IDs and fetch TLEs in one batch request.
    all_norad: list[str] = [
        nid for sats in CONSTELLATION_SATS.values() for nid in sats
    ]
    tle_map = await _fetch_tles(all_norad)
    logger.info("TLEs fetched: %d/%d — resolved: %s — missing: %s",
                len(tle_map), len(all_norad),
                sorted(tle_map.keys()),
                sorted(set(all_norad) - set(tle_map.keys())))

    features: list[dict] = []
    included = 0
    total_s = TRACK_HOURS * 3600

    for constellation, sats in CONSTELLATION_SATS.items():
        for norad_id, sat_name in sats.items():
            tle = tle_map.get(norad_id)
            if not tle:
                logger.debug("No TLE for %s (%s)", sat_name, norad_id)
                continue

            # 1-minute track for accurate distance checking and overpass points
            fine_track = _propagate(tle[0], tle[1], now, OVERPASS_STEP_S, total_s)
            if not fine_track:
                continue

            distances = [
                _haversine_km(center_lat, center_lon, p["lat"], p["lon"])
                for p in fine_track
            ]
            min_dist = min(distances)
            if min_dist > PASS_RADIUS_KM:
                continue

            included += 1

            # 5-minute track for the LineString (smaller payload)
            coarse_track = _propagate(tle[0], tle[1], now, TRACK_STEP_S, total_s)

            # Build antimeridian-safe MultiLineString
            coords = [[p["lon"], p["lat"]] for p in coarse_track]
            timestamps = [p["ts"] for p in coarse_track]
            altitudes = [p["alt_km"] for p in coarse_track]
            segments = _split_antimeridian(coords)
            geometry: dict[str, Any] = (
                {"type": "MultiLineString", "coordinates": segments}
                if len(segments) != 1
                else {"type": "LineString", "coordinates": segments[0]}
            )

            features.append({
                "type": "Feature",
                "geometry": geometry,
                "properties": {
                    "feature_type": "track",
                    "constellation": constellation,
                    "satellite_name": sat_name,
                    "norad_id": norad_id,
                    "min_distance_km": round(min_dist, 1),
                    "timestamps": timestamps,
                    "altitudes_km": altitudes,
                },
            })

            # Overpass points (1-minute resolution, within 100 km)
            for pt, dist in zip(fine_track, distances):
                if dist <= PASS_RADIUS_KM:
                    features.append({
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [pt["lon"], pt["lat"]]},
                        "properties": {
                            "feature_type": "overpass",
                            "constellation": constellation,
                            "satellite_name": sat_name,
                            "norad_id": norad_id,
                            "timestamp": pt["ts"],
                            "altitude_km": pt["alt_km"],
                            "distance_km": round(dist, 1),
                        },
                    })

    logger.info(
        "Trajectories: %d/%d satellites within %d km → %d features",
        included, len(all_norad), PASS_RADIUS_KM, len(features),
    )
    constellations_with_tracks = {f["properties"]["constellation"] for f in features if f["properties"].get("feature_type") == "track"}
    constellations_empty = set(CONSTELLATION_SATS.keys()) - constellations_with_tracks
    if constellations_empty:
        logger.info("No passes within %d km for: %s", PASS_RADIUS_KM, ", ".join(sorted(constellations_empty)))
    return {"type": "FeatureCollection", "features": features, "properties": {"constellations_with_tracks": list(constellations_with_tracks)}}
