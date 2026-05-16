"""Mission Window Analysis endpoints — backed by `src/service/analysis/mission_window.py`."""

from fastapi import APIRouter, HTTPException

from src.api.schemas import MissionConditions, MissionWindowResponse
from src.service.analysis.mission_window import MissionWindowError, analyse

router = APIRouter(prefix="/api/mission-window", tags=["mission-window"])


@router.post("/analyse", response_model=MissionWindowResponse)
async def analyse_mission_window(conditions: MissionConditions) -> MissionWindowResponse:
    """Score the AOI's ECMWF forecast against the supplied conditions."""
    try:
        return analyse(conditions.aoi_id, conditions)
    except MissionWindowError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
