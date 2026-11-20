"""
Suggest UC activities from a connected Google account (Gmail + Calendar).

Readonly: uses stored OAuth credentials. Returns candidate name/role/description
rows for the student to confirm in chat — never writes to their profile by itself.

Gmail: a search of the last two years of *received* mail for activity words (teams, clubs, jobs,
volunteering, awards), plus the newest received messages. It used to take the newest 50 messages of
any kind, sent mail included, so an activity email quietly dropped out once 50 newer messages (or
emails the student sent) came in. Calendar: a short window. No Drive scan.
"""

from __future__ import annotations

import base64
import binascii
import html
import logging
import re
from datetime import datetime, timedelta, timezone

import google_oauth
from activities import clean_items
from llm_utils import parse_json
from query import complete, last_failure

log = logging.getLogger("google_activities")

# Messages matching the activity search, and the newest received ones (for anything the search misses).
MAX_GMAIL_SEARCH = 50
MAX_GMAIL_RECENT = 20
# `{a b}` is Gmail's OR. Sent mail isn't excluded in the query: a message the student sends to
# themselves (or a forward to their own address) is labelled Sent *and* Inbox, and is often exactly
# the evidence we want. True outgoing mail (Sent, not Inbox) is dropped after fetching instead.
# The activity search keeps every inbox tab (team apps often land in Promotions or Social).
GMAIL_BASE = "-in:drafts -in:chats"
GMAIL_RECENT = f"{GMAIL_BASE} -category:promotions -category:social"
GMAIL_ACTIVITY_WORDS = (
    "team practice game match tournament league season roster tryout tryouts varsity coach captain "
    "club meeting officer president rehearsal concert recital band orchestra choir theater "
    "volunteer volunteering service shift schedule internship job hired employment paycheck "
    "award honor honors scholarship winner finalist nominated selected congratulations competition"
)
GMAIL_LOOKBACK = "newer_than:2y"
MAX_CAL = 20
MAX_SNIPPET = 280
# Gmail's snippet is only the first ~200 characters of the body, so the key line ("you've been named
# captain of the soccer team") is often cut off. We also read the body and keep the sentences that
# talk about activities, up to this many characters per email.
MAX_BODY_EVIDENCE = 600
# Words that make a body sentence worth keeping (the search words, plus common sports and arts).
EVIDENCE_WORDS = set(GMAIL_ACTIVITY_WORDS.split()) | {
    "named", "made", "joined", "elected", "won", "championship", "teammates", "squad", "lead", "leader",
    "soccer", "basketball", "football", "baseball", "softball", "volleyball", "tennis", "swim", "swimming",
    "track", "cross", "golf", "wrestling", "lacrosse", "hockey", "water", "polo", "cheer", "dance", "debate",
    "robotics", "piano", "violin", "guitar", "drama", "musical", "choir", "art", "newspaper", "yearbook",
    "volunteered", "hours", "tutor", "tutoring", "mentor", "intern", "employee", "manager", "shift",
}
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
- Each email is its own "[Email N]" line. Every row must come from ONE email and use only what that
  email says. Never combine details from different emails (e.g. a sport named in one email with a
  captaincy or championship from another). If an email doesn't name the sport or club, don't guess
  one from another email.
- Skip classes, homework, doctors/dentists, shopping, random social plans.
- name: short title case (e.g. "Soccer Team"). role: title if clear, else "".
- description: one short UC-style sentence about the student in that activity, paraphrased from
  the evidence (e.g. "Dedicated member who attends meetings consistently", "Named team captain
  after the championship season"). Never copy or lightly rephrase email wording — no greetings,
  thank-yous, "congrats", or sign-offs. Facts only from that one email, or "".
- section: activities | volunteering | job | awards.
- One underlying thing = one row (don't split the same evidence into activity + award). Prefer
  section "activities" and put role/win in role or description.
- Prefer distinct items; merge duplicates. At most 10. If nothing clear, {"activities": []}.
"""


def _gmail_snippets(user_id: str) -> list[str]:
    from googleapiclient.discovery import build

    service = build("gmail", "v1", credentials=google_oauth.credentials_for(user_id), cache_discovery=False)
    messages = service.users().messages()
    ids: list[str] = []
    for query, limit in (
        (f"{GMAIL_BASE} {GMAIL_LOOKBACK} {{{GMAIL_ACTIVITY_WORDS}}}", MAX_GMAIL_SEARCH),
        (GMAIL_RECENT, MAX_GMAIL_RECENT),
    ):
        listed = messages.list(userId="me", q=query, maxResults=limit).execute()
        for item in listed.get("messages") or []:
            if item["id"] not in ids:
                ids.append(item["id"])
    out: list[str] = []
    for message_id in ids:
        msg = messages.get(userId="me", id=message_id, format="full").execute()
        labels = set(msg.get("labelIds") or [])
        if "SENT" in labels and "INBOX" not in labels:
            continue  # Mail the student sent to someone else isn't evidence of their own activity.
        payload = msg.get("payload") or {}
        headers = {h["name"].lower(): h.get("value", "") for h in payload.get("headers") or []}
        subject = headers.get("subject", "")
        sender = headers.get("from", "")
        snippet = html.unescape(msg.get("snippet") or "")[:MAX_SNIPPET]
        evidence = _evidence(_body_text(payload), snippet)
        # Each email is its own numbered line, so the model can keep their details apart.
        line = f"[Email {len(out) + 1}] From: {sender}. Subject: {subject}. {snippet}"
        if evidence:
            line += f" … {evidence}"
        out.append(line.strip())
    log.info("gmail activity scan user_id=%s hits=%s", user_id, len(out))
    return out


def _body_text(payload: dict) -> str:
    """The email's plain text: the text/plain part, else the HTML part with tags removed."""
    plain: list[str] = []
    rich: list[str] = []

    def walk(part: dict) -> None:
        data = (part.get("body") or {}).get("data")
        mime = part.get("mimeType", "")
        if data and mime in ("text/plain", "text/html"):
            try:
                decoded = base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", "replace")
            except (ValueError, binascii.Error):
                decoded = ""
            (plain if mime == "text/plain" else rich).append(decoded)
        for child in part.get("parts") or []:
            walk(child)

    walk(payload)
    if plain:
        text = "\n".join(plain)
    else:
        text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", "\n".join(rich), flags=re.S | re.I)
        text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    # Drop the quoted thread under a reply ("On Tue, … wrote:" and "> " lines).
    text = re.split(r"\n\s*On .{0,200}wrote:\s*\n", text, maxsplit=1)[0]
    text = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith(">"))
    return re.sub(r"\s+", " ", text).strip()


def _evidence(body: str, snippet: str) -> str:
    """Sentences from the body that talk about activities and aren't already in the snippet."""
    seen = re.sub(r"\s+", " ", snippet).strip().lower()
    kept: list[str] = []
    size = 0
    for sentence in re.split(r"(?<=[.!?])\s+", body):
        sentence = sentence.strip()
        if not sentence or sentence.lower() in seen:
            continue
        words = set(re.findall(r"[a-z]+", sentence.lower()))
        if not words & EVIDENCE_WORDS:
            continue
        if size + len(sentence) > MAX_BODY_EVIDENCE:
            break
        kept.append(sentence)
        size += len(sentence) + 1
    return " ".join(kept)


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
