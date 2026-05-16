"""Feature-scoped FastAPI routers.

Each module exposes one `router: APIRouter`. `src/api/main.py` includes these
routers, so feature routing changes stay isolated to one module per feature.
"""

from . import aoi
from . import dem
from . import infrastructure
from . import jobs
from . import land
from . import layers
from . import mcoo
from . import mml
from . import satellites
from . import system
from . import traffic_cameras
from . import water
from . import weather

__all__ = [
    "system",
    "aoi",
    "jobs",
    "layers",
    "weather",
    "water",
    "land",
    "infrastructure",
    "dem",
    "satellites",
    "traffic_cameras",
    "mcoo",
    "mml",
]
