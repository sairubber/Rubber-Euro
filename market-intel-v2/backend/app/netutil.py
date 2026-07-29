"""One retry for the free public feeds. Every desk fetcher already keeps a
cache-fallback for hard failures; a single retry on top absorbs the routine
transient hiccup so a cold-cache request (fresh Render deploy) doesn't come
back empty over a one-off timeout."""

from __future__ import annotations

import time

import httpx


def get_retry(url: str, *, params=None, headers=None, timeout: float = 30, follow_redirects: bool = False, attempts: int = 2) -> httpx.Response:
    last: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            resp = httpx.get(url, params=params, headers=headers, timeout=timeout, follow_redirects=follow_redirects)
            resp.raise_for_status()
            return resp
        except Exception as exc:  # noqa: BLE001 — caller's cache-fallback handles the re-raise
            last = exc
            if attempt < attempts:
                time.sleep(2)
    raise last  # type: ignore[misc]
