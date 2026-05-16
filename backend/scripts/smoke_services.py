"""Smoke test — run every service individually against a test bbox.

Usage (from backend/ directory):
    uv run python -m scripts.smoke_services
    uv run python -m scripts.smoke_services -- 24.8 60.1 25.2 60.3

The default bbox covers the Helsinki area.
Lapland example:     23.0 68.0 30.0 70.5
North Karelia:       28.5 61.5 31.0 63.5
Archipelago Sea:     21.0 59.5 23.5 60.5

Each service is called with a temporary aoi_id so output files are written to
src/data/<aoi_id>/<category>/ — inspect those files to verify the actual data.
"""

import asyncio
import sys
import uuid

from src.service._shared.bbox import BBox
from src.service._shared.storage import create_aoi
from src.service.ecmwf.weather import fetch_weather
from src.service.nls.land import fetch_land
from src.service.nls.water import fetch_water
from src.service.osm.infra import fetch_infra


def _print_result(label: str, summary: dict) -> None:
    print(f"\n{'='*60}")
    print(f"  {label}")
    print(f"  source:     {summary.get('source', '—')}")
    if "error" in summary:
        print(f"  ERROR:      {summary['error']}")
    else:
        counts = summary.get("feature_counts") or {}
        for key, val in counts.items():
            print(f"  {key:<20} {val}")
        # WeatherGrid summary fields
        if "grid_points" in summary:
            print(f"  grid_points:         {summary['grid_points']}")
        if "time_steps" in summary:
            print(f"  time_steps:          {summary['time_steps']}")
    print(f"{'='*60}")


async def main(bbox: BBox) -> None:
    aoi_id = str(uuid.uuid4())
    create_aoi(aoi_id, {
        "min_lon": bbox.min_lon,
        "min_lat": bbox.min_lat,
        "max_lon": bbox.max_lon,
        "max_lat": bbox.max_lat,
    })

    print(f"\nSmoke test")
    print(f"  bbox:   {bbox}")
    print(f"  aoi_id: {aoi_id}")
    print(f"  files → backend/src/data/{aoi_id}/\n")

    services = [
        ("ecmwf.weather.fetch_weather",   fetch_weather),
        ("nls.water.fetch_water",         fetch_water),
        ("nls.land.fetch_land",           fetch_land),
        ("osm.infra.fetch_infra",         fetch_infra),
    ]

    for label, fetch_fn in services:
        try:
            summary = await fetch_fn(aoi_id, bbox)
            _print_result(label, summary)
        except Exception as exc:
            _print_result(label, {"source": label, "error": str(exc)})

    from src.service._shared.client import close_client
    await close_client()


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
