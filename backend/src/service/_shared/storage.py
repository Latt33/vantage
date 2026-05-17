"""Filesystem storage utilities for AoI data.

All AoI data lives under DATA_ROOT/{aoi_id}/{category}/.
Data persists across container restarts via the bind mount configured in
docker-compose.yml (./data:/app/data).

Path structure (current):
    data/{aoi_id}/{category}/

The path is designed so a user namespace can be inserted later without
changing anything below it:
    data/{user_id}/{aoi_id}/{category}/

Nothing in this module knows about Redis or HTTP. It is pure filesystem I/O.
"""

import json
import math
import os
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Root and TTL config
# ---------------------------------------------------------------------------

# src/data/ — created at runtime, not committed, not volume-mounted.
# Vercel cannot persist writes to the checked-in tree, so use /tmp there unless
# an explicit DATA_ROOT is provided.
_DEFAULT_DATA_ROOT = Path(__file__).parent.parent.parent.parent / "data"
if os.getenv("DATA_ROOT"):
    DATA_ROOT: Path = Path(os.getenv("DATA_ROOT", "")).expanduser()
elif os.getenv("VERCEL") == "1":
    DATA_ROOT = Path("/tmp/data")
else:
    DATA_ROOT = _DEFAULT_DATA_ROOT

# How long each category's data is considered fresh.
# Staleness is checked by comparing fetched_at in meta.json against now.
CATEGORY_TTL: dict[str, timedelta] = {
    "weather":           timedelta(hours=12),
    "water":             timedelta(days=7),
    "land":              timedelta(days=7),
    "satellite_imagery": timedelta(days=7),
    "infrastructure":    timedelta(hours=24),
    "dem":               timedelta(days=7),
    "satellites":        timedelta(hours=24),
    "cellular":          timedelta(days=7),
    "traffic_cameras":   timedelta(hours=1),
    "mcoo":              timedelta(hours=24),
    "derived":           timedelta(hours=24),
}


# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------

def aoi_root(aoi_id: str) -> Path:
    return DATA_ROOT / aoi_id


def category_dir(aoi_id: str, category: str) -> Path:
    return aoi_root(aoi_id) / category


def category_file(aoi_id: str, category: str, filename: str) -> Path:
    return category_dir(aoi_id, category) / filename


# ---------------------------------------------------------------------------
# I/O helpers
# ---------------------------------------------------------------------------

def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_json(path: Path, data: dict | list) -> None:
    ensure_dir(path.parent)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, default=str)


def read_json(path: Path) -> dict | list | None:
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# AoI metadata
# ---------------------------------------------------------------------------

def create_aoi(aoi_id: str, bbox: dict) -> None:
    """Initialise the AoI root directory and write top-level meta.json."""
    ensure_dir(aoi_root(aoi_id))
    meta = {
        "aoi_id": aoi_id,
        "bbox": bbox,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    write_json(aoi_root(aoi_id) / "meta.json", meta)


def get_aoi_meta(aoi_id: str) -> dict | None:
    meta = read_json(aoi_root(aoi_id) / "meta.json")
    if meta is not None:
        return meta

    bundled_meta = _DEFAULT_DATA_ROOT / aoi_id / "meta.json"
    return read_json(bundled_meta)


def delete_aoi(aoi_id: str) -> None:
    from src.service._shared.test_areas import TEST_AREA_IDS  # late import avoids cycle
    if aoi_id in TEST_AREA_IDS:
        raise ValueError(f"Test area '{aoi_id}' is protected and cannot be deleted.")
    root = aoi_root(aoi_id)
    if root.exists():
        shutil.rmtree(root)


def list_aois() -> list[dict]:
    """List all existing AOIs with their metadata."""
    aois: list[dict] = []
    seen_ids: set[str] = set()

    def collect_from_root(root: Path) -> None:
        if not root.exists():
            return
        for d in root.iterdir():
            if not (d.is_dir() and (d / "meta.json").exists()):
                continue
            meta = read_json(d / "meta.json")
            if not isinstance(meta, dict):
                continue
            aoi_id = meta.get("aoi_id")
            if not isinstance(aoi_id, str) or not aoi_id:
                continue
            if aoi_id in seen_ids:
                continue
            seen_ids.add(aoi_id)
            aois.append(meta)

    # Runtime writable AOIs first.
    collect_from_root(DATA_ROOT)
    # Fallback to bundled test areas shipped in the image/repo.
    if _DEFAULT_DATA_ROOT.resolve() != DATA_ROOT.resolve():
        collect_from_root(_DEFAULT_DATA_ROOT)

    aois.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return aois


def find_aoi_by_bbox(bbox: dict) -> str | None:
    """Return the aoi_id of an existing AOI whose bbox exactly matches, or None.

    Compares all five bbox keys (min_lon, min_lat, max_lon, max_lat) to float
    precision. Returns the most-recently created match so the freshest cached
    data is preferred when duplicates exist.
    """
    if not DATA_ROOT.exists():
        return None

    keys = ("min_lon", "min_lat", "max_lon", "max_lat")
    for d in sorted(DATA_ROOT.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if not (d.is_dir() and (d / "meta.json").exists()):
            continue
        meta = read_json(d / "meta.json")
        if not meta:
            continue
        stored = meta.get("bbox", {})
        try:
            if all(float(stored[k]) == float(bbox[k]) for k in keys):
                return meta["aoi_id"]
        except (KeyError, TypeError, ValueError):
            continue
    return None


def cleanup_old_aois(max_age_days: int = 30) -> int:
    """Delete AOI directories whose created_at is older than max_age_days.

    Returns the number of directories removed. Errors on individual dirs are
    logged and skipped so one corrupt entry never blocks the rest.
    """
    import logging
    logger = logging.getLogger(__name__)

    if not DATA_ROOT.exists():
        return 0

    from src.service._shared.test_areas import TEST_AREA_IDS  # late import avoids cycle

    cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
    removed = 0
    for d in DATA_ROOT.iterdir():
        if not (d.is_dir() and (d / "meta.json").exists()):
            continue
        if d.name in TEST_AREA_IDS:
            continue  # test areas are always kept
        meta = read_json(d / "meta.json")
        if not meta:
            continue
        try:
            created_at = datetime.fromisoformat(meta["created_at"])
            if created_at < cutoff:
                shutil.rmtree(d)
                logger.info("cleanup_old_aois: removed %s (created %s)", d.name, meta["created_at"])
                removed += 1
        except (KeyError, ValueError, OSError) as exc:
            logger.warning("cleanup_old_aois: skipped %s — %s", d.name, exc)

    return removed


# ---------------------------------------------------------------------------
# Test area bootstrap
# ---------------------------------------------------------------------------

def ensure_test_areas() -> None:
    """Create meta.json for each test area if it doesn't already exist.

    Called at app startup so test areas survive a fresh checkout with an
    empty data/ directory. Safe to call repeatedly — existing dirs are
    left untouched.
    """
    from src.service._shared.test_areas import TEST_AREAS
    for area in TEST_AREAS:
        root = aoi_root(area.aoi_id)
        meta_path = root / "meta.json"

        if meta_path.exists():
            continue
        ensure_dir(root)
        meta = {
            "aoi_id": area.aoi_id,
            "name": area.name,
            "bbox": {
                "min_lon": area.bbox.min_lon,
                "min_lat": area.bbox.min_lat,
                "max_lon": area.bbox.max_lon,
                "max_lat": area.bbox.max_lat,
            },
            "created_at": datetime.now(timezone.utc).isoformat(),
            "test_area": True,
        }
        write_json(meta_path, meta)


# ---------------------------------------------------------------------------
# Category metadata and staleness
# ---------------------------------------------------------------------------

def write_category_meta(
    aoi_id: str,
    category: str,
    source: str,
    confidence: str,
    feature_counts: dict[str, int],
) -> None:
    meta = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "confidence": confidence,
        "feature_counts": feature_counts,
    }
    write_json(category_dir(aoi_id, category) / "meta.json", meta)


def get_category_meta(aoi_id: str, category: str) -> dict | None:
    return read_json(category_dir(aoi_id, category) / "meta.json")


def is_stale(aoi_id: str, category: str) -> bool:
    """Return True if the category data is missing or older than its TTL."""
    meta = get_category_meta(aoi_id, category)
    if meta is None:
        return True
    try:
        fetched_at = datetime.fromisoformat(meta["fetched_at"])
        ttl = CATEGORY_TTL.get(category, timedelta(hours=24))
        return datetime.now(timezone.utc) - fetched_at > ttl
    except (KeyError, ValueError):
        return True
