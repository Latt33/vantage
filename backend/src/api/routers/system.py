"""System-level endpoints (liveness, version, etc.)."""

from fastapi import APIRouter

router = APIRouter(tags=["system"])


@router.get("/health")
def health() -> dict:
    """Liveness probe — returns immediately if the process is up."""
    return {"status": "ok"}
