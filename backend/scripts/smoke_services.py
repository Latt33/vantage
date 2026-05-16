"""Smoke test — run every service individually against a test bbox.

Usage (from backend/ directory):
    uv run python -m scripts.smoke_services
    uv run python -m scripts.smoke_services -- 24.8 60.1 25.2 60.3

The default bbox covers the Helsinki area.
Lapland example:     23.0 68.0 30.0 70.5
North Karelia:       28.5 61.5 31.0 63.5
Archipelago Sea:     21.0 59.5 23.5 60.5
"""

import asyncio
import json
import sys

from src.service._shared.bbox import BBox
from src.service.ecmwf.weather import fetch_weather
from src.service.nls.terrain import fetch_terrain
from src.service.osm.infra import fetch_infra


def _print_result(label: str, payload: dict) -> None:
    status = payload.get("status", "ok")
    source = payload.get("source", "—")
    confidence = payload.get("confidence", "—")
    n_features = len(payload.get("features", []))
    error = payload.get("error", "")

    print(f"\n{'='*60}")
    print(f"  {label}")
    print(f"  source:     {source}")
    print(f"  confidence: {confidence}")
    print(f"  features:   {n_features}")
    print(f"  status:     {status}")
    if error:
        print(f"  error:      {error}")

    features = payload.get("features", [])
    if features:
        print(f"\n  sample properties (feature 0):")
        props = features[0].get("properties", {})
        print("  " + json.dumps(props, indent=4, ensure_ascii=False, default=str)
              .replace("\n", "\n  "))
    print(f"{'='*60}")


async def main(bbox: BBox) -> None:
    print(f"\nSmoke test — bbox: {bbox}\n")

    services = [
        ("nls.terrain.fetch_terrain",     fetch_terrain),
        ("ecmwf.weather.fetch_weather",   fetch_weather),
        ("osm.infra.fetch_infra",         fetch_infra),
    ]

    for label, fetch_fn in services:
        try:
            result = await fetch_fn(bbox)
            _print_result(label, result)
        except Exception as exc:
            _print_result(label, {"status": "error", "error": str(exc), "features": []})


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) == 4:
        try:
            bbox = BBox(float(args[0]), float(args[1]), float(args[2]), float(args[3]))
            bbox.validate()
        except ValueError as e:
            print(f"Invalid bbox: {e}")
            sys.exit(1)
    else:
        bbox = BBox(min_lon=24.8, min_lat=60.1, max_lon=25.2, max_lat=60.3)
        print("No bbox given — using default (Helsinki area)")

    asyncio.run(main(bbox))
