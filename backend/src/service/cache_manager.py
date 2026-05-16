import os
import json
import hashlib
from typing import Any, Optional

CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data_cache")

# Ensure the cache directory exists
os.makedirs(CACHE_DIR, exist_ok=True)

def _generate_cache_key(prefix: str, params: dict) -> str:
    """Generates a unique filename based on the query parameters."""
    # Sort keys to ensure consistent hashing regardless of dictionary order
    param_string = json.dumps(params, sort_keys=True)
    hash_object = hashlib.md5(param_string.encode('utf-8'))
    return f"{prefix}_{hash_object.hexdigest()}.json"

def get_cached_data(prefix: str, params: dict) -> Optional[Any]:
    """Retrieve data from local JSON cache if it exists."""
    cache_file = os.path.join(CACHE_DIR, _generate_cache_key(prefix, params))
    if os.path.exists(cache_file):
        print(f"Loading cached data from {cache_file}")
        with open(cache_file, "r", encoding="utf-8") as f:
            return json.load(f)
    return None

def save_to_cache(prefix: str, params: dict, data: Any) -> None:
    """Save data to local JSON cache."""
    cache_file = os.path.join(CACHE_DIR, _generate_cache_key(prefix, params))
    print(f"Saving data to cache at {cache_file}")
    with open(cache_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
