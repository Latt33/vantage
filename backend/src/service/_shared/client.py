"""Shared async HTTP client for all services.

Named client.py (not http.py) to avoid shadowing the stdlib http module.
All URLs passed to this client must use HTTPS.

Import the module-level `client` instance in service modules:

    from src.service._shared.client import client

Call close_client() on application shutdown (handled by FastAPI lifespan in api/main.py).
"""

import httpx

_CONNECT_TIMEOUT = 10.0
_READ_TIMEOUT = 30.0

client = httpx.AsyncClient(
    timeout=httpx.Timeout(
        connect=_CONNECT_TIMEOUT,
        read=_READ_TIMEOUT,
        write=10.0,
        pool=5.0,
    ),
    follow_redirects=True,
    headers={"User-Agent": "AI2PB/1.0 (hackathon research tool; contact laakso.atte@gmail.com)"},
)


async def close_client() -> None:
    """Close the shared client. Called once on application shutdown."""
    await client.aclose()
