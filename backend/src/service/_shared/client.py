"""Shared async HTTP client for all services.

Named client.py (not http.py) to avoid shadowing the stdlib http module.
All URLs passed to this client must use HTTPS.
"""

import httpx

# Default timeouts in seconds
_CONNECT_TIMEOUT = 10.0
_READ_TIMEOUT = 30.0

# One module-level client instance reused across requests.
# All external service modules import and use this directly.
client = httpx.AsyncClient(
    timeout=httpx.Timeout(connect=_CONNECT_TIMEOUT, read=_READ_TIMEOUT, write=10.0, pool=5.0),
    follow_redirects=True,
    headers={"User-Agent": "AI2PB/1.0 (hackathon research tool)"},
)
