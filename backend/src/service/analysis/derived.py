"""Derived-analysis orchestrator.

Builds derived overlays that depend only on already-cached datasets and
persists them under the shared `derived/` category.
"""

from __future__ import annotations

import asyncio

from src.service._shared.bbox import BBox
from src.service._shared.storage import write_category_meta
from src.service.analysis.fpv_threat import build_fpv_threat_stack
from src.service.analysis.movement_corridors import build_movement_corridors_heavy


async def build_derived(aoi_id: str, bbox: BBox) -> dict:
    movement_summary = await asyncio.to_thread(build_movement_corridors_heavy, aoi_id, bbox)
    fpv_summary = await asyncio.to_thread(build_fpv_threat_stack, aoi_id, bbox)

    feature_counts = {
        "movement_cells_valid": int(
            ((movement_summary.get("counts") or {}).get("cells_valid") or 0)
        ),
        "fpv_time_steps": int(fpv_summary.get("time_steps") or 0),
        "fpv_wind_grid_points": int(
            ((fpv_summary.get("counts") or {}).get("wind_grid_points") or 0)
        ),
    }
    confidence = "high"
    if movement_summary.get("status") == "missing_dem" or fpv_summary.get("status") == "missing_inputs":
        confidence = "low"

    write_category_meta(
        aoi_id,
        "derived",
        source="Derived movement corridors and FPV threat areas",
        confidence=confidence,
        feature_counts=feature_counts,
    )
    return {
        "source": "Derived movement corridors and FPV threat areas",
        "movement_corridors": movement_summary,
        "fpv_threat": fpv_summary,
    }