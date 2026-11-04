"""
Cloud mode for the UC application assistant: a Browserbase browser that the same Playwright
script in uc_account attaches to over CDP, instead of a Chrome window on this computer.

The API key stays on the server (BROWSERBASE_API_KEY in .env). Settings stay inside the free
tier: no proxies, no keepAlive, default region, and a short timeout. Recording and session
logging are turned off because the pages hold the student's personal information.
"""

from __future__ import annotations

import os
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

API_BASE = os.getenv("BROWSERBASE_API_URL", "https://api.browserbase.com/v1").rstrip("/")
# Free-tier sessions are short; Browserbase ends the session itself after this many seconds.
SESSION_TIMEOUT_S = 900
REQUEST_TIMEOUT_S = 30
# Tag on every session this app starts, so leftovers can be found and closed (see release_leftovers).
APP_TAG = {"app": "track2college-uc-assistant"}


class CloudBrowserError(Exception):
    pass


def _key() -> str:
    return os.getenv("BROWSERBASE_API_KEY", "").strip()


def configured() -> bool:
    return bool(_key())


def _headers() -> dict[str, str]:
    return {"X-BB-API-Key": _key(), "Content-Type": "application/json"}


def create_session() -> tuple[str, str]:
    """Starts a Browserbase session and returns (session id, CDP connect URL)."""
    if not configured():
        raise CloudBrowserError("Cloud mode isn't set up on the server.")
    body: dict = {
        "browserSettings": {"recordSession": False, "logSession": False},
        "timeout": SESSION_TIMEOUT_S,
        "userMetadata": APP_TAG,
    }
    project = os.getenv("BROWSERBASE_PROJECT_ID", "").strip()
    if project:
        body["projectId"] = project
    try:
        response = requests.post(f"{API_BASE}/sessions", json=body, headers=_headers(), timeout=REQUEST_TIMEOUT_S)
    except requests.RequestException as exc:
        raise CloudBrowserError(f"Couldn't reach Browserbase: {exc}") from exc
    if response.status_code >= 400:
        # Never echo the key; Browserbase's error text is safe to log.
        raise CloudBrowserError(f"Browserbase refused the session ({response.status_code}): {response.text[:200]}")
    data = response.json()
    if not data.get("id") or not data.get("connectUrl"):
        raise CloudBrowserError("Browserbase didn't return a session to connect to.")
    return data["id"], data["connectUrl"]


def live_url(session_id: str) -> str | None:
    """The interactive live view, so the student can see and use the cloud window."""
    try:
        response = requests.get(f"{API_BASE}/sessions/{session_id}/debug", headers=_headers(), timeout=REQUEST_TIMEOUT_S)
        response.raise_for_status()
        return response.json().get("debuggerFullscreenUrl") or None
    except Exception as exc:  # noqa: BLE001 — the run still works without the live view
        print(f"[cloud_browser] no live view for {session_id}: {exc}")
        return None


def release(session_id: str) -> None:
    """Ends the session now instead of waiting for its timeout."""
    try:
        requests.post(
            f"{API_BASE}/sessions/{session_id}",
            json={"status": "REQUEST_RELEASE"},
            headers=_headers(),
            timeout=REQUEST_TIMEOUT_S,
        ).raise_for_status()
    except Exception as exc:  # noqa: BLE001 — Browserbase still ends it at the timeout
        print(f"[cloud_browser] couldn't release {session_id}: {exc}")


def release_leftovers(keep: set[str] | None = None) -> int:
    """Closes this app's sessions that are still running but no run is using (e.g. after a backend
    restart lost track of them), so they stop using browser time. Returns how many were closed."""
    if not configured():
        return 0
    try:
        response = requests.get(f"{API_BASE}/sessions", params={"status": "RUNNING"}, headers=_headers(), timeout=REQUEST_TIMEOUT_S)
        response.raise_for_status()
        sessions = response.json()
    except Exception as exc:  # noqa: BLE001 — cleanup is best effort
        print(f"[cloud_browser] couldn't list sessions: {exc}")
        return 0
    closed = 0
    for session in sessions if isinstance(sessions, list) else []:
        meta = session.get("userMetadata") or {}
        if meta.get("app") == APP_TAG["app"] and session.get("id") not in (keep or set()):
            release(session["id"])
            closed += 1
    if closed:
        print(f"[cloud_browser] closed {closed} leftover session(s)")
    return closed
