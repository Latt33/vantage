"""Filesystem storage utilities for AoI data.

All AoI data lives under DATA_ROOT/{aoi_id}/{category}/.
Data is ephemeral — the directory is created at runtime and does not
survive container restarts. No Docker volumes or bind mounts are used.

Path structure (current):
    src/data/{aoi_id}/{category}/

The path is designed so a user namespace can be inserted later without
changing anything below it:
    src/data/{user_id}/{aoi_id}/{category}/

Nothing in this module knows about Redis or HTTP. It is pure filesystem I/O.
"""

import json
import math
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Root and TTL config
# ---------------------------------------------------------------------------

# src/data/ — created at runtime, not committed, not volume-mounted
DATA_ROOT: Path = Path(__file__).parent.parent.parent.parent / "data"

# How long each category's data is considered fresh.
# Staleness is checked by comparing fetched_at in meta.json against now.
CATEGORY_TTL: dict[str, timedelta] = {
    "weather":        timedelta(hours=6),
    "water":          timedelta(days=7),
    "land":           timedelta(days=7),
    "satellite_imagery": timedelta(days=7),
    "infrastructure": timedelta(hours=24),
    "mcoo":           timedelta(hours=24),
    "derived":        timedelta(hours=24),
    "traffic_cameras": timedelta(hours=1),
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
    return read_json(aoi_root(aoi_id) / "meta.json")


def delete_aoi(aoi_id: str) -> None:
    root = aoi_root(aoi_id)
    if root.exists():
        shutil.rmtree(root)


def list_aois() -> list[dict]:
    """List all existing AOIs with their metadata."""
    if not DATA_ROOT.exists():
        return []
        
    aois = []
    for d in DATA_ROOT.iterdir():
        if d.is_dir() and (d / "meta.json").exists():
            meta = read_json(d / "meta.json")
            if meta:
                aois.append(meta)
    
    # Sort by created_at descending (newest first)
    aois.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return aois


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
