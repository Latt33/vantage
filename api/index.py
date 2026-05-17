"""Vercel entrypoint for the FastAPI backend."""

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parent.parent
BACKEND_ROOT = ROOT / "backend"

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from src.api.main import app  # noqa: E402