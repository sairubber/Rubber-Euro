"""One retry for the free public feeds. Every desk fetcher already keeps a
cache-fallback for hard failures; a single retry on top absorbs the routine
transient hiccup so a cold-cache request (fresh Render deploy) doesn't come
back empty over a one-off timeout."""

from __future__ import annotations

import time

import httpx


# Binding the local side to 0.0.0.0 forces IPv4 — some hosts (sina) publish
# AAAA records that die with errno 101 on IPv6-less networks like Render.
_ipv4_transport = httpx.HTTPTransport(local_address="0.0.0.0", retries=1)


def get_retry(
    url: str,
    *,
    params=None,
    headers=None,
    timeout: float = 30,
    follow_redirects: bool = False,
    attempts: int = 2,
    ipv4: bool = False,
) -> httpx.Response:
    last: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            if ipv4:
                with httpx.Client(transport=_ipv4_transport, timeout=timeout, follow_redirects=follow_redirects) as client:
                    resp = client.get(url, params=params, headers=headers)
            else:
                resp = httpx.get(url, params=params, headers=headers, timeout=timeout, follow_redirects=follow_redirects)
            resp.raise_for_status()
            return resp
        except Exception as exc:  # noqa: BLE001 — caller's cache-fallback handles the re-raise
            last = exc
            if attempt < attempts:
                time.sleep(2)
    raise last  # type: ignore[misc]
