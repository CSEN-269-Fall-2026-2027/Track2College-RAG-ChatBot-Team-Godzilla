"""
Agentic mode: find the student's school counselor on the web and draft the email
the student sends them. Nothing is sent from here — the student reviews the draft
in their own mail app and clicks Send.
"""

import json
import re

from llm_utils import parse_json, text
from query import complete

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

FIND_PROMPT = """\
You look up public staff directories for high school students on the Track2College platform.

Search the web for the school counselors (guidance / academic / college counselors) at the
student's high school. Prefer the school's or district's own website.

RULES:
1. Only list people you found on a web page. Never guess or construct an email address; leave
   "email" empty if the page doesn't show one.
2. "serves" is who the counselor is assigned to exactly as the page says it (a last-name range
   like "A-Gh", grade levels, or a program). Empty if the page doesn't say.
3. Set "match" to true only for the counselor(s) whose assignment covers this student (compare
   the student's last name alphabetically against last-name ranges). If nothing says, all false.
4. "source_url" is the page where you found that person.

Respond with ONLY a JSON object, no markdown fences:
{"counselors": [{"name": "", "title": "", "email": "", "serves": "", "match": false, "source_url": ""}]}
"""

EMAIL_PROMPT = """\
You help a high school senior write a clear, polite email asking their school counselor for a
meeting about their University of California (UC) application.

RULES:
1. Use ONLY facts from the STUDENT PROFILE and what the student said on the PRACTICE CALL, if
   there was one. Never invent grades, activities, plans, or finished work. Ignore what the
   practice counselor said except as context for the student's answers.
2. The subject line says this is a meeting request about the UC application.
3. Write the body as plain text in exactly this order, with a blank line between sections:

   a. A greeting to the counselor.
   b. One or two sentences: who the student is (name, and grade if the profile gives it), and
      that they would like to schedule a short meeting to go over their UC application before
      they submit it. The meeting request must be clear from this opening.
   c. A line reading "What I have prepared so far:" followed by a list, one item per line, each
      starting with "- ". Include only items the profile shows, such as: UC campuses on their
      list, intended major, GPA, exams, activities, awards, Personal Insight Question status,
      FAFSA or California Dream Act status. Keep each item to one line and summarize long lists.
      Report Personal Insight Question status exactly as the profile gives it; never call work
      finished unless the profile says so. If the profile shows nothing, leave this section out.
   d. A line reading "What I would like to go over:" followed by a "- " list of two or three
      specific things, taken from the practice call or from "Biggest college question" and "Wants
      help with first" in the profile. Also ask whether the counselor needs anything from them
      (for example, anything the school tracks for seniors). Leave out any topic with no basis.
   e. One closing sentence asking what day and time would work for the counselor. Do not propose
      specific dates or times.

4. Never mention the practice call or that an AI was involved. Never mention the student's
   birthday, birthplace, household income, or budget.
5. Under 200 words, warm and direct, in the student's own voice. No markdown other than the "- "
   list items: no bold, no headings.
6. NEVER write placeholders or brackets like [Name], [Last], or [Grade]. If the profile is
   missing a fact, leave it out and write around it.
7. End with the closing sentence: no closing ("Sincerely," "Best,") and no name. The sign-off is
   added for you.

Respond with ONLY a JSON object, no markdown fences:
{"subject": "", "body": ""}
"""


def find_counselors(high_school: str, city: str, state: str, last_name: str) -> list[dict]:
    where = ", ".join(part for part in (city.strip(), state.strip()) if part)
    user_message = (
        f"=== High school ===\n{high_school.strip()}{f' ({where})' if where else ''}\n\n"
        f"=== Student last name ===\n{last_name.strip() or '(not given)'}"
    )
    raw = complete(FIND_PROMPT, user_message, max_tokens=2500, web_search=True)
    if not raw:
        raise RuntimeError("The language model didn't respond. Check GROQ_API_KEY in .env at the project root.")
    try:
        data = parse_json(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        print(f"[counselor] Could not parse model output: {exc}\n{raw[:800]}")
        raise RuntimeError("The counselor search came back in an unexpected format. Please try again.") from exc

    counselors = []
    for row in data.get("counselors") or []:
        if not isinstance(row, dict) or not text(row.get("name")):
            continue
        email = text(row.get("email"))
        source = text(row.get("source_url"))
        counselors.append(
            {
                "name": text(row.get("name")),
                "title": text(row.get("title")),
                "email": email if EMAIL_RE.match(email) else "",
                "serves": text(row.get("serves")),
                "match": row.get("match") is True,
                "source_url": source if source.startswith(("http://", "https://")) else "",
            }
        )
    # Best matches first; the student confirms before anything is written.
    counselors.sort(key=lambda c: (not c["match"], not c["email"]))
    return counselors[:8]


PLACEHOLDER_RE = re.compile(r"\s*\[[^\]\n]*\]")
CLOSING_RE = re.compile(
    r"(sincerely|best|best regards|regards|kind regards|warm regards|warmly|respectfully|thanks|thank you),?",
    re.IGNORECASE,
)


def finish_email(body: str, student_name: str) -> str:
    """Drops any placeholders or sign-off the model wrote anyway, then signs with the student's real name."""
    name = student_name.strip()
    lines = [PLACEHOLDER_RE.sub("", line).rstrip() for line in body.strip().splitlines()]
    # A closing near the end starts the model's own sign-off: cut it and the name lines under it.
    for i in range(len(lines) - 1, max(len(lines) - 4, -1), -1):
        if CLOSING_RE.fullmatch(lines[i].strip()):
            del lines[i:]
            break
    while lines and lines[-1].strip() in ("", name):
        lines.pop()
    return "\n".join(lines) + "\n\nSincerely," + (f"\n{name}" if name else "")


def draft_counselor_email(counselor_name: str, student_name: str, profile_summary: str, call_transcript: str = "") -> dict:
    call = (
        f"=== Practice call with a counselor (the student's own words count as facts) ===\n{call_transcript.strip()}\n\n"
        if call_transcript.strip()
        else ""
    )
    user_message = (
        f"=== Counselor ===\n{counselor_name.strip()}\n\n"
        f"=== Student name ===\n{student_name.strip() or '(not given)'}\n\n"
        f"{call}"
        f"=== Student Profile ===\n{profile_summary.strip() or '(empty)'}"
    )
    raw = complete(EMAIL_PROMPT, user_message, max_tokens=1200)
    if not raw:
        raise RuntimeError("The language model didn't respond. Check GROQ_API_KEY in .env at the project root.")
    try:
        data = parse_json(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        print(f"[counselor] Could not parse email output: {exc}\n{raw[:800]}")
        raise RuntimeError("The email draft came back in an unexpected format. Please try again.") from exc

    subject, body = text(data.get("subject")), text(data.get("body"))
    if not body:
        raise RuntimeError("The email draft came back empty. Please try again.")
    subject = PLACEHOLDER_RE.sub("", subject).strip()
    return {"subject": subject or "UC application — meeting request", "body": finish_email(body, student_name)}
