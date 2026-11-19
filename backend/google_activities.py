"""
Suggest UC activities from a connected Google account (Gmail + Calendar).

Readonly: uses stored OAuth credentials. Returns candidate name/role/description
rows for the student to confirm in chat — never writes to their profile by itself.

Scoped for speed: newest 50 emails only, a short calendar window, no Drive scan.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import google_oauth
from activities import clean_items
from llm_utils import parse_json
from query import complete, last_failure

log = logging.getLogger("google_activities")

MAX_GMAIL = 50
MAX_CAL = 20
MAX_SNIPPET = 280
# Calendar: last 90 days + next 30 days only.
CAL_LOOKBACK_DAYS = 90
CAL_LOOKAHEAD_DAYS = 30

SYSTEM = """\
You find extracurricular activities, volunteering, jobs, and awards for a high school student's
UC application from their Gmail snippets and Google Calendar event titles.

The mailbox belongs to THIS student. Only return activities that clearly APPLY TO THEM as a
participant (player, member, officer, employee, volunteer, awardee) — not things they were
merely invited to, told about, or that happen to mention a sport/club word.

Return only JSON:
{"activities": [{"name": "...", "role": "...", "description": "...", "section": "activities|volunteering|job|awards"}]}

Include ONLY when evidence shows the student is personally involved, e.g.:
- A coach/advisor names them for a role ("you've been named captain", "congrats on making varsity").
- Award/honor they received; job/internship offer or schedule addressed to them as the worker.
- Ongoing membership they clearly hold (roster, officer slate with their name, "your shift at…").

Do NOT include when it's only:
- Game/event invitations ("you are invited", "join us tonight", open house, spectator invites).
- Mass mail ("Hi Everyone", team-wide blasts with no personal role for this student).
- News, reminders, tickets, or calendar holds that don't prove they play/work/volunteer there.
- Mentions of basketball/soccer/club in passing with no personal involvement.

Other rules:
- Skip classes, homework, doctors/dentists, shopping, random social plans.
- name: short title case (e.g. "Soccer Team"). role: title if clear, else "".
- description: one short sentence from the evidence, or "".
- section: activities | volunteering | job | awards.
- One underlying thing = one row (don't split the same evidence into activity + award). Prefer
  section "activities" and put role/win in role or description.
- Prefer distinct items; merge duplicates. At most 10. If nothing clear, {"activities": []}.
"""


def _gmail_snippets(user_id: str) -> list[str]:
    from googleapiclient.discovery import build

    service = build("gmail", "v1", credentials=google_oauth.credentials_for(user_id), cache_discovery=False)
    # Newest 50 messages only — no multi-year keyword search.
    listed = service.users().messages().list(userId="me", maxResults=MAX_GMAIL).execute()
    out: list[str] = []
    for item in listed.get("messages") or []:
        msg = service.users().messages().get(
            userId="me",
            id=item["id"],
            format="metadata",
            metadataHeaders=["Subject", "From"],
        ).execute()
        headers = {h["name"].lower(): h.get("value", "") for h in (msg.get("payload") or {}).get("headers") or []}
        subject = headers.get("subject", "")
        sender = headers.get("from", "")
        snippet = (msg.get("snippet") or "")[:MAX_SNIPPET]
        line = f"From: {sender}. Subject: {subject}. {snippet}".strip()
        if line:
            out.append(line)
    log.info("gmail activity scan user_id=%s hits=%s", user_id, len(out))
    return out


def _calendar_lines(user_id: str) -> list[str]:
    from googleapiclient.discovery import build

    service = build("calendar", "v3", credentials=google_oauth.credentials_for(user_id), cache_discovery=False)
    now = datetime.now(timezone.utc)
    time_min = (now - timedelta(days=CAL_LOOKBACK_DAYS)).isoformat()
    time_max = (now + timedelta(days=CAL_LOOKAHEAD_DAYS)).isoformat()
    result = (
        service.events()
        .list(
            calendarId="primary",
            timeMin=time_min,
            timeMax=time_max,
            maxResults=MAX_CAL,
            singleEvents=True,
            orderBy="startTime",
        )
        .execute()
    )
    out: list[str] = []
    for event in result.get("items") or []:
        summary = (event.get("summary") or "").strip()
        if not summary:
            continue
        start = (event.get("start") or {}).get("dateTime") or (event.get("start") or {}).get("date") or ""
        out.append(f"{start[:10]} {summary}"[:MAX_SNIPPET])
    log.info("calendar activity scan user_id=%s hits=%s", user_id, len(out))
    return out


def gather_signals(user_id: str) -> dict[str, list[str]]:
    gmail: list[str] = []
    calendar: list[str] = []
    try:
        gmail = _gmail_snippets(user_id)
    except Exception:  # noqa: BLE001 — still try calendar
        log.warning("gmail activity scan failed", exc_info=True)
    try:
        calendar = _calendar_lines(user_id)
    except Exception:  # noqa: BLE001
        log.warning("calendar activity scan failed", exc_info=True)
    return {"gmail": gmail, "calendar": calendar}


def suggest_activities(user_id: str) -> list[dict[str, str]]:
    if not google_oauth.status_for(user_id).connected:
        raise google_oauth.GoogleOAuthError("Google isn't connected for this account.")
    signals = gather_signals(user_id)
    if not signals["gmail"] and not signals["calendar"]:
        return []
    parts = []
    if signals["gmail"]:
        parts.append("Gmail:\n" + "\n".join(f"- {s}" for s in signals["gmail"]))
    if signals["calendar"]:
        parts.append("Calendar:\n" + "\n".join(f"- {s}" for s in signals["calendar"]))
    completion = complete(SYSTEM, "\n\n".join(parts), max_tokens=1500)
    if not completion:
        raise RuntimeError(last_failure() or "Couldn't reach the model. Please try again.")
    try:
        data = parse_json(completion)
    except ValueError as error:
        raise RuntimeError("Couldn't read activity suggestions. Please try again.") from error
    items = clean_items(data)
    # Preserve section when the model sent one.
    raw = data.get("activities") if isinstance(data, dict) else None
    sections: dict[str, str] = {}
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict) and item.get("name"):
                sec = str(item.get("section") or "activities").lower()
                if sec not in {"activities", "volunteering", "job", "awards"}:
                    sec = "activities"
                sections[str(item["name"]).strip().lower()] = sec
    out: list[dict[str, str]] = []
    for item in items:
        row = dict(item)
        row["section"] = sections.get(row["name"].lower(), "activities")
        out.append(row)
    return _dedupe_related(out)


def _token_set(text: str) -> set[str]:
    return {t for t in "".join(ch.lower() if ch.isalnum() else " " for ch in text).split() if len(t) > 2}


def _dedupe_related(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    """Drop near-duplicate rows (same evidence split into activity + award). Prefer activities."""
    if len(rows) < 2:
        return rows
    ranked = sorted(rows, key=lambda r: (0 if r.get("section") == "activities" else 1, r.get("name", "")))
    kept: list[dict[str, str]] = []
    for row in ranked:
        tokens = _token_set(f"{row.get('name', '')} {row.get('role', '')} {row.get('description', '')}")
        if not tokens:
            kept.append(row)
            continue
        duplicate = False
        for prior in kept:
            prior_tokens = _token_set(f"{prior.get('name', '')} {prior.get('role', '')} {prior.get('description', '')}")
            if not prior_tokens:
                continue
            overlap = len(tokens & prior_tokens) / max(1, min(len(tokens), len(prior_tokens)))
            if overlap >= 0.45:
                duplicate = True
                # Prefer keeping role/championship detail on the first (usually activities) row.
                if not prior.get("role") and row.get("role"):
                    prior["role"] = row["role"]
                if row.get("description") and (
                    not prior.get("description")
                    or (len(row["description"]) > len(prior["description"]) and "championship" in row["description"].lower())
                ):
                    prior["description"] = row["description"]
                break
        if not duplicate:
            kept.append(row)
    return kept
