"""
Tiny in-process TTL cache for hot read endpoints. The site polls the same
handful of endpoints every minute from every open tab; the underlying data
only actually changes when a scrape or climate pass commits. Caching the
serialized responses for a short window (and invalidating on every commit)
means repeated polls cost a dict lookup instead of a SQLite query.

Deliberately not Redis/memcached — one process, one worker, zero deps.
"""

import threading
import time
from typing import Any

DEFAULT_TTL_SECONDS = 30.0

_lock = threading.Lock()
_store: dict[str, tuple[float, Any]] = {}


def get(key: str) -> Any | None:
    with _lock:
        entry = _store.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if time.monotonic() > expires_at:
            del _store[key]
            return None
        return value


def put(key: str, value: Any, ttl: float = DEFAULT_TTL_SECONDS) -> None:
    with _lock:
        _store[key] = (time.monotonic() + ttl, value)


def invalidate_all() -> None:
    """Called after any scrape/climate commit — new data must be visible on
    the very next poll, not up to a TTL later."""
    with _lock:
        _store.clear()
