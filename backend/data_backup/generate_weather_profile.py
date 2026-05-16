"""Generate the demo weather fallback profile JSON.

Run from the backend folder:
    python data_backup/generate_weather_profile.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from src.service.ecmwf.weather_backup import BACKUP_PROFILE_PATH, generate_demo_weather_profile  # noqa: E402


def main() -> None:
    profile = generate_demo_weather_profile()
    BACKUP_PROFILE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(BACKUP_PROFILE_PATH, "w", encoding="utf-8") as handle:
        json.dump(profile, handle, indent=2)
    print(f"Wrote fallback weather profile to {BACKUP_PROFILE_PATH}")


if __name__ == "__main__":
    main()