"""
Connect Google: OAuth for readonly Gmail, Calendar, and Drive.

App login stays Supabase email/password. This module only stores encrypted refresh
tokens so the API can read Google data later. Chat and product features do not call
these helpers yet.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlencode

import requests
from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

log = logging.getLogger("google_oauth")

SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
]

AUTH_URI = "https://accounts.google.com/o/oauth2/auth"
TOKEN_URI = "https://oauth2.googleapis.com/token"
REVOKE_URI = "https://oauth2.googleapis.com/revoke"
USERINFO_URI = "https://www.googleapis.com/oauth2/v2/userinfo"

STATE_TTL_S = 600
REQUEST_TIMEOUT_S = 15


class GoogleOAuthError(Exception):
    """Safe, user-facing OAuth failure."""


@dataclass(frozen=True)
class GoogleStatus:
    connected: bool
    google_email: Optional[str] = None
    scopes: tuple[str, ...] = ()
    connected_at: Optional[str] = None


def _env(name: str) -> str:
    return (os.getenv(name) or "").strip()


def configured() -> bool:
    return bool(
        _env("GOOGLE_CLIENT_ID")
        and _env("GOOGLE_CLIENT_SECRET")
        and _env("GOOGLE_REDIRECT_URI")
        and _env("GOOGLE_TOKEN_ENCRYPTION_KEY")
        and _env("SUPABASE_SERVICE_ROLE_KEY")
        and (_env("SUPABASE_URL") or _env("VITE_SUPABASE_URL"))
    )


def frontend_origin() -> str:
    return (_env("GOOGLE_FRONTEND_ORIGIN") or "http://localhost:5500").rstrip("/")


def _supabase_url() -> str:
    return (_env("SUPABASE_URL") or _env("VITE_SUPABASE_URL")).rstrip("/")


def _service_key() -> str:
    return _env("SUPABASE_SERVICE_ROLE_KEY")


def _client_config() -> dict[str, Any]:
    return {
        "web": {
            "client_id": _env("GOOGLE_CLIENT_ID"),
            "client_secret": _env("GOOGLE_CLIENT_SECRET"),
            "auth_uri": AUTH_URI,
            "token_uri": TOKEN_URI,
            "redirect_uris": [_env("GOOGLE_REDIRECT_URI")],
        }
    }


def _fernet() -> Fernet:
    key = _env("GOOGLE_TOKEN_ENCRYPTION_KEY").encode()
    try:
        return Fernet(key)
    except Exception as exc:  # noqa: BLE001
        raise GoogleOAuthError("Google token encryption isn't set up correctly on this server.") from exc


def _state_secret() -> bytes:
    # Prefer the encryption key; fall back to client secret so state still verifies in misconfig edge cases.
    raw = _env("GOOGLE_TOKEN_ENCRYPTION_KEY") or _env("GOOGLE_CLIENT_SECRET")
    return hashlib.sha256(raw.encode()).digest()


def make_state(user_id: str) -> str:
    payload = {"uid": user_id, "exp": int(time.time()) + STATE_TTL_S}
    body = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    sig = hmac.new(_state_secret(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def parse_state(state: str) -> str:
    try:
        body, sig = state.rsplit(".", 1)
    except ValueError as exc:
        raise GoogleOAuthError("That Google connect link is invalid. Try again.") from exc
    expected = hmac.new(_state_secret(), body.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        raise GoogleOAuthError("That Google connect link is invalid. Try again.")
    pad = "=" * (-len(body) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(body + pad))
    except Exception as exc:  # noqa: BLE001
        raise GoogleOAuthError("That Google connect link is invalid. Try again.") from exc
    if int(payload.get("exp") or 0) < int(time.time()):
        raise GoogleOAuthError("That Google connect link expired. Try again.")
    user_id = str(payload.get("uid") or "")
    if not user_id:
        raise GoogleOAuthError("That Google connect link is invalid. Try again.")
    return user_id


def encrypt_refresh_token(token: str) -> str:
    return _fernet().encrypt(token.encode()).decode()


def decrypt_refresh_token(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:
        raise GoogleOAuthError("Couldn't unlock the saved Google connection. Disconnect and connect again.") from exc


def _rest_headers(*, prefer: Optional[str] = None) -> dict[str, str]:
    key = _service_key()
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def _require_configured() -> None:
    if not configured():
        raise GoogleOAuthError(
            "Connect Google isn't set up on this server yet (GOOGLE_* / SUPABASE_SERVICE_ROLE_KEY)."
        )


def _flow() -> Flow:
    # Confidential web client (client_secret). Disable PKCE so start/callback
    # can use separate Flow instances without a shared code_verifier.
    return Flow.from_client_config(
        _client_config(),
        scopes=SCOPES,
        redirect_uri=_env("GOOGLE_REDIRECT_URI"),
        autogenerate_code_verifier=False,
    )


def authorization_url(user_id: str) -> str:
    _require_configured()
    flow = _flow()
    url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        state=make_state(user_id),
    )
    return url


def _upsert_connection(
    user_id: str,
    *,
    google_email: Optional[str],
    scopes: list[str],
    refresh_token_ciphertext: str,
    token_uri: str,
) -> None:
    url = f"{_supabase_url()}/rest/v1/google_connections"
    body = {
        "user_id": user_id,
        "google_email": google_email,
        "scopes": scopes,
        "refresh_token_ciphertext": refresh_token_ciphertext,
        "token_uri": token_uri or TOKEN_URI,
        "connected_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "revoked_at": None,
    }
    response = requests.post(
        f"{url}?on_conflict=user_id",
        headers=_rest_headers(prefer="resolution=merge-duplicates,return=minimal"),
        json=body,
        timeout=REQUEST_TIMEOUT_S,
    )
    if response.status_code >= 400:
        log.error("google_connections upsert failed: %s %s", response.status_code, response.text[:300])
        raise GoogleOAuthError("Couldn't save your Google connection. Try again in a moment.")


def _fetch_row(user_id: str) -> Optional[dict[str, Any]]:
    response = requests.get(
        f"{_supabase_url()}/rest/v1/google_connections",
        headers=_rest_headers(),
        params={
            "user_id": f"eq.{user_id}",
            "revoked_at": "is.null",
            "select": "user_id,google_email,scopes,refresh_token_ciphertext,token_uri,connected_at,revoked_at",
            "limit": "1",
        },
        timeout=REQUEST_TIMEOUT_S,
    )
    if response.status_code >= 400:
        log.error("google_connections read failed: %s %s", response.status_code, response.text[:300])
        raise GoogleOAuthError("Couldn't check your Google connection. Try again in a moment.")
    rows = response.json()
    return rows[0] if rows else None


def _delete_row(user_id: str) -> None:
    response = requests.delete(
        f"{_supabase_url()}/rest/v1/google_connections",
        headers=_rest_headers(prefer="return=minimal"),
        params={"user_id": f"eq.{user_id}"},
        timeout=REQUEST_TIMEOUT_S,
    )
    if response.status_code >= 400:
        log.error("google_connections delete failed: %s %s", response.status_code, response.text[:300])
        raise GoogleOAuthError("Couldn't disconnect Google. Try again in a moment.")


def _google_email(credentials: Credentials) -> Optional[str]:
    if not credentials.token:
        return None
    try:
        response = requests.get(
            USERINFO_URI,
            headers={"Authorization": f"Bearer {credentials.token}"},
            timeout=REQUEST_TIMEOUT_S,
        )
        if response.status_code == 200:
            return (response.json().get("email") or "").strip() or None
    except requests.RequestException:
        log.warning("Could not fetch Google userinfo email", exc_info=True)
    return None


def complete_oauth(code: str, state: str) -> str:
    """Exchange the auth code, store the encrypted refresh token, return user_id."""
    _require_configured()
    user_id = parse_state(state)
    flow = _flow()
    try:
        flow.fetch_token(code=code)
    except Exception as exc:  # noqa: BLE001
        log.warning("Google token exchange failed", exc_info=True)
        raise GoogleOAuthError("Google didn't finish connecting. Try again.") from exc

    credentials = flow.credentials
    refresh = credentials.refresh_token
    if not refresh:
        # Re-consent may omit a new refresh token if one already exists; keep prior row if present.
        existing = _fetch_row(user_id)
        if existing and existing.get("refresh_token_ciphertext"):
            email = _google_email(credentials) or existing.get("google_email")
            scopes = list(credentials.scopes or existing.get("scopes") or SCOPES)
            _upsert_connection(
                user_id,
                google_email=email,
                scopes=scopes,
                refresh_token_ciphertext=existing["refresh_token_ciphertext"],
                token_uri=credentials.token_uri or TOKEN_URI,
            )
            log.info("google_connected user_id=%s reused_refresh=1", user_id)
            return user_id
        raise GoogleOAuthError(
            "Google didn't return a lasting connection. Disconnect in Google Account settings and try again."
        )

    email = _google_email(credentials)
    scopes = list(credentials.scopes or SCOPES)
    _upsert_connection(
        user_id,
        google_email=email,
        scopes=scopes,
        refresh_token_ciphertext=encrypt_refresh_token(refresh),
        token_uri=credentials.token_uri or TOKEN_URI,
    )
    log.info("google_connected user_id=%s", user_id)
    return user_id


def status_for(user_id: str) -> GoogleStatus:
    if not configured():
        return GoogleStatus(connected=False)
    row = _fetch_row(user_id)
    if not row:
        return GoogleStatus(connected=False)
    scopes = tuple(row.get("scopes") or ())
    return GoogleStatus(
        connected=True,
        google_email=row.get("google_email"),
        scopes=scopes,
        connected_at=row.get("connected_at"),
    )


def credentials_for(user_id: str) -> Credentials:
    """Build refreshed Google credentials for later API reads. Not used by chat yet."""
    _require_configured()
    row = _fetch_row(user_id)
    if not row:
        raise GoogleOAuthError("Google isn't connected for this account.")
    refresh = decrypt_refresh_token(row["refresh_token_ciphertext"])
    creds = Credentials(
        token=None,
        refresh_token=refresh,
        token_uri=row.get("token_uri") or TOKEN_URI,
        client_id=_env("GOOGLE_CLIENT_ID"),
        client_secret=_env("GOOGLE_CLIENT_SECRET"),
        scopes=list(row.get("scopes") or SCOPES),
    )
    creds.refresh(GoogleAuthRequest())
    return creds


def disconnect(user_id: str) -> None:
    _require_configured()
    row = _fetch_row(user_id)
    if not row:
        return
    try:
        refresh = decrypt_refresh_token(row["refresh_token_ciphertext"])
        requests.post(REVOKE_URI, data={"token": refresh}, timeout=REQUEST_TIMEOUT_S)
    except Exception:  # noqa: BLE001 — still clear local row if revoke fails
        log.warning("Google revoke failed; clearing local connection", exc_info=True)
    _delete_row(user_id)
    log.info("google_disconnected user_id=%s", user_id)


def frontend_redirect(*, ok: bool, detail: str = "") -> str:
    params = {"google": "connected" if ok else "error"}
    if detail and not ok:
        params["google_error"] = detail[:180]
    return f"{frontend_origin()}/?{urlencode(params)}"


# --- Thin read helpers for later product use (not wired to routes/UI yet) ---

def smoke_calendar_title(user_id: str) -> Optional[str]:
    from googleapiclient.discovery import build

    service = build("calendar", "v3", credentials=credentials_for(user_id), cache_discovery=False)
    result = service.calendarList().list(maxResults=1).execute()
    items = result.get("items") or []
    return (items[0].get("summary") if items else None)


def smoke_drive_filename(user_id: str) -> Optional[str]:
    from googleapiclient.discovery import build

    service = build("drive", "v3", credentials=credentials_for(user_id), cache_discovery=False)
    result = service.files().list(pageSize=1, fields="files(name)").execute()
    items = result.get("files") or []
    return (items[0].get("name") if items else None)


def smoke_gmail_snippet(user_id: str) -> Optional[str]:
    from googleapiclient.discovery import build

    service = build("gmail", "v1", credentials=credentials_for(user_id), cache_discovery=False)
    listed = service.users().messages().list(userId="me", maxResults=1).execute()
    messages = listed.get("messages") or []
    if not messages:
        return None
    msg = service.users().messages().get(userId="me", id=messages[0]["id"], format="metadata").execute()
    return msg.get("snippet")
