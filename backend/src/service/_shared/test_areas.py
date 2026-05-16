"""Fixed test areas for the AI2PB challenge.

These three AOIs are always kept on disk and are never cleaned up by
cleanup_old_aois() or deletable via the API. They are committed to git
so any fresh checkout has them available without re-fetching.

Challenge target areas:
  1 — Archipelago Sea   (Saaristomeri)
  2 — North Karelia     (Pohjois-Karjala)
  3 — Lapland           (Käsivarren Lappi)
"""

from __future__ import annotations

from dataclasses import dataclass

from src.service._shared.bbox import BBox


@dataclass(frozen=True)
class TestArea:
    aoi_id: str
    name: str
    bbox: BBox


TEST_AREAS: tuple[TestArea, ...] = (
    TestArea(
        aoi_id="test_archipelago_sea",
        name="Archipelago Sea",
        bbox=BBox(min_lon=21.5, min_lat=59.8, max_lon=23.2, max_lat=60.5),
    ),
    TestArea(
        aoi_id="test_north_karelia",
        name="North Karelia",
        bbox=BBox(min_lon=29.3, min_lat=62.2, max_lon=30.8, max_lat=63.4),
    ),
    TestArea(
        aoi_id="test_lapland_kasivarsi",
        name="Käsivarren Lappi",
        bbox=BBox(min_lon=20.5, min_lat=68.0, max_lon=24.5, max_lat=70.1),
    ),
)

# Set of AOI IDs that must never be deleted or cleaned up.
TEST_AREA_IDS: frozenset[str] = frozenset(a.aoi_id for a in TEST_AREAS)
