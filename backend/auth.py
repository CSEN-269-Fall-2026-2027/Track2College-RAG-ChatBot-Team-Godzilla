"""
Who is calling. Every API route except /health needs the student's Supabase session
(`Authorization: Bearer <access token>`, which the frontend already sends).

The token is checked with Supabase Auth itself (GET /auth/v1/user), so this server needs only the
project URL and the public anon key, never the service-role key. A verified token is remembered
for up to a minute (never past its own expiry) to avoid one round trip per request.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import requests
from dotenv import load_dotenv
from fastapi import Header, HTTPException

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

CACHE_S = 60
REQUEST_TIMEOUT_S = 10
_MAX_CACHED = 2000

_cache: dict[str, tuple[str, float]] = {}
_lock = threading.Lock()


@dataclass(frozen=True)
class Student:
    """The signed-in student."""

    id: str


def supabase_url() -> str:
    return (os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL") or "").strip().rstrip("/")


def anon_key() -> str:
    return (os.getenv("SUPABASE_ANON_KEY") or os.getenv("VITE_SUPABASE_ANON_KEY") or "").strip()


def _expires_at(token: str) -> float:
    """The token's own `exp` as a monotonic deadline (unverified read; Supabase already verified it)."""
    try:
        payload = token.split(".")[1]
        exp = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))["exp"]
        return time.monotonic() + max(0.0, float(exp) - time.time())
    except Exception:  # noqa: BLE001 — no readable exp: fall back to the short cache window
        return time.monotonic() + CACHE_S


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=401, detail=detail, headers={"WWW-Authenticate": "Bearer"})


def verify(token: str) -> str:
    """Returns the student id for a valid access token, or raises 401 (bad token) / 503 (can't check)."""
    key = hashlib.sha256(token.encode()).hexdigest()
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
    if hit and hit[1] > now:
        return hit[0]

    url, anon = supabase_url(), anon_key()
    if not url or not anon:
        raise HTTPException(status_code=503, detail="Sign-in checks aren't set up on this server (SUPABASE_URL / SUPABASE_ANON_KEY).")
    try:
        response = requests.get(
            f"{url}/auth/v1/user",
            headers={"apikey": anon, "Authorization": f"Bearer {token}"},
            timeout=REQUEST_TIMEOUT_S,
        )
    except requests.RequestException:
        raise HTTPException(status_code=503, detail="Couldn't check your sign-in. Try again in a moment.")
    if response.status_code >= 500:
        raise HTTPException(status_code=503, detail="Couldn't check your sign-in. Try again in a moment.")
    student_id = response.json().get("id") if response.status_code == 200 else None
    if not student_id:
        raise _unauthorized("Your session has expired. Sign in again.")

    with _lock:
        if len(_cache) >= _MAX_CACHED:
            for stale in [k for k, (_, until) in _cache.items() if until <= now] or list(_cache)[: _MAX_CACHED // 2]:
                _cache.pop(stale, None)
        _cache[key] = (student_id, min(now + CACHE_S, _expires_at(token)))
    return student_id


def current_student(authorization: Optional[str] = Header(default=None)) -> Student:
    """FastAPI dependency: the signed-in student, derived only from their verified session."""
    scheme, _, token = (authorization or "").partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        raise _unauthorized("Sign in to use Track2College.")
    return Student(id=verify(token))
