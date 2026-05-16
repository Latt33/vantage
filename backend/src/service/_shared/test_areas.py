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
        # ~50×50 km centred on the western archipelago (lat 60°: 0.9°lon ≈ 50 km)
        bbox=BBox(min_lon=21.9, min_lat=59.9, max_lon=22.8, max_lat=60.35),
    ),
    TestArea(
        aoi_id="test_north_karelia",
        name="North Karelia",
        # ~50×50 km centred on Joensuu area (lat 62.8°: 1.0°lon ≈ 50 km)
        bbox=BBox(min_lon=29.3, min_lat=62.55, max_lon=30.3, max_lat=63.0),
    ),
    TestArea(
        aoi_id="test_lapland_kasivarsi",
        name="Käsivarren Lappi",
        # ~50×50 km centred on Enontekiö (lat 69°: 1.3°lon ≈ 52 km)
        bbox=BBox(min_lon=20.9, min_lat=68.75, max_lon=22.2, max_lat=69.2),
    ),
)

# Set of AOI IDs that must never be deleted or cleaned up.
TEST_AREA_IDS: frozenset[str] = frozenset(a.aoi_id for a in TEST_AREAS)
