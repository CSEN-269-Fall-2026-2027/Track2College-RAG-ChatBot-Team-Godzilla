"""
Find UC's emailed verification code in the student's connected Gmail (read-only), so the UC
assistant can type it in for them instead of asking.

Only works when UC sends the code to the same Gmail account the student connected. Only emails
that arrived after UC asked for the code count, so an old code is never reused. The code itself is
never logged (the caller registers it with redact).
"""

from __future__ import annotations

import logging
import re

log = logging.getLogger("uc_code_mail")

# UC's real email: from noreply@ucop.edu ("UC Application Center"), subject "UC application – Verify
# your account", text "…Your verification code is 12345678, enter this 8-digit code into the
# verification…". The other terms are a fallback in case UC changes the sender. `{a b}` is Gmail's OR.
UC_CODE_QUERY = (
    'newer_than:1d {from:noreply@ucop.edu from:ucop.edu from:universityofcalifornia.edu '
    'subject:"verify your account" "verification code"}'
)
MAX_MESSAGES = 5
# Allow for small clock differences between Gmail and this server.
CLOCK_SLACK_S = 120
# A code is 4–10 letters or digits with at least one digit, so words like "below" or "expires" are
# never taken for one. It's the first such token shortly after "code" ("Your verification code is
# 12345678", "Use the code below to verify your account: A7K29Q"); failing that, a 6–8 digit number.
_CODE_WORD = re.compile(r"\b(?:code|passcode|pin)\b", re.I)
_TOKEN = re.compile(r"\b[A-Za-z0-9]{4,10}\b")
_DIGITS = re.compile(r"\b(\d{6,8})\b")
NEAR_CODE_CHARS = 150


def code_in(text: str) -> str | None:
    """The verification code in an email's text, or None."""
    for word in _CODE_WORD.finditer(text):
        for token in _TOKEN.finditer(text, word.end(), word.end() + NEAR_CODE_CHARS):
            if any(ch.isdigit() for ch in token.group()):
                return token.group()
    match = _DIGITS.search(text)
    return match.group(1) if match else None


def find_code(user_id: str, since: float, exclude: set[str] | frozenset[str] = frozenset()) -> str | None:
    """The newest code UC emailed after `since` (Unix seconds) that isn't in `exclude`, or None.
    Never raises: no Google connection, or any Gmail error, just means "not found"."""
    try:
        import google_oauth
        from googleapiclient.discovery import build

        from google_activities import _body_text

        if not google_oauth.status_for(user_id).connected:
            return None
        service = build("gmail", "v1", credentials=google_oauth.credentials_for(user_id), cache_discovery=False)
        messages = service.users().messages()
        listed = messages.list(userId="me", q=UC_CODE_QUERY, maxResults=MAX_MESSAGES).execute()
        for item in listed.get("messages") or []:  # newest first
            msg = messages.get(userId="me", id=item["id"], format="full").execute()
            if int(msg.get("internalDate") or 0) / 1000 < since - CLOCK_SLACK_S:
                continue
            payload = msg.get("payload") or {}
            subject = next((h.get("value", "") for h in payload.get("headers") or [] if h.get("name", "").lower() == "subject"), "")
            code = code_in(f"{subject}\n{msg.get('snippet') or ''}\n{_body_text(payload)}")
            if code and code not in exclude:
                return code
    except Exception as exc:  # noqa: BLE001 — falling back to asking the student is always fine
        log.warning("couldn't look for the UC code in Gmail: %s", type(exc).__name__)
    return None
