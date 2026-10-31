"""
Profile analysis: LLM review of a student's profile and UC campus list.
"""

import json

from llm_utils import http_urls, parse_json, strings
from query import complete

MAX_COLLEGES = 8
FITS = {"reach", "target", "likely", "unknown"}

SYSTEM_PROMPT = """\
You are a careful college counselor for the Track2College platform. You review one
student's profile and UC campus list.

RULES:
1. Focus on University of California freshman admission. Use well-known UC guidance
   (A–G, PIQs, comprehensive review). Prefer universityofcalifornia.edu facts; if unsure,
   say so and set fit to "unknown".
2. Facts about the student come only from the STUDENT PROFILE. Never invent grades, scores, or
   activities. If something important is missing from the profile, list it under "gaps".
3. Fit labels: "reach", "target", "likely", or "unknown". Be honest but encouraging; never
   promise admission.
4. "sources" may include well-known official URLs only (e.g. https://admission.universityofcalifornia.edu/).
5. Actions must be concrete, specific to this student, and ordered by urgency.
6. Write for a high school student: plain, warm, direct. Keep each string under 60 words.

Respond with ONLY a JSON object, no markdown fences, matching exactly:
{
  "summary": "2-3 sentence overview of where the student stands",
  "strengths": ["..."],
  "gaps": ["..."],
  "colleges": [{"name": "...", "fit": "reach|target|likely|unknown", "reasoning": "...", "sources": ["https://..."]}],
  "actions": [{"title": "short imperative", "detail": "...", "timeframe": "e.g. This week / By Nov 1 / Senior fall"}]
}
Give 2-5 strengths, 2-5 gaps, one entry per college in the list, and 3-6 actions.
"""


def _normalize(data: dict, colleges: list[str]) -> dict:
    college_rows = []
    for row in data.get("colleges") or []:
        if not isinstance(row, dict) or not str(row.get("name", "")).strip():
            continue
        fit = str(row.get("fit", "unknown")).strip().lower()
        college_rows.append({
            "name": str(row["name"]).strip(),
            "fit": fit if fit in FITS else "unknown",
            "reasoning": str(row.get("reasoning", "")).strip(),
            "sources": http_urls(row.get("sources"), 3),
        })

    covered = {row["name"].lower() for row in college_rows}
    for name in colleges:
        if name.lower() not in covered:
            college_rows.append({
                "name": name,
                "fit": "unknown",
                "reasoning": "Not enough profile detail yet to estimate fit for this campus.",
                "sources": [],
            })

    actions = []
    for row in data.get("actions") or []:
        if isinstance(row, dict) and str(row.get("title", "")).strip():
            actions.append({
                "title": str(row["title"]).strip(),
                "detail": str(row.get("detail", "")).strip(),
                "timeframe": str(row.get("timeframe", "")).strip(),
            })

    return {
        "summary": str(data.get("summary", "")).strip(),
        "strengths": strings(data.get("strengths"), 6),
        "gaps": strings(data.get("gaps"), 6),
        "colleges": college_rows,
        "actions": actions[:8],
    }


def analyze_profile(profile_summary: str, colleges: list[str], majors: list[str]) -> dict:
    colleges = [c.strip() for c in colleges if c.strip()][:MAX_COLLEGES]
    majors = [m.strip() for m in majors if m.strip()]

    user_message = (
        f"=== Student Profile ===\n{profile_summary.strip() or '(empty)'}\n\n"
        f"=== UC Campuses ===\n{', '.join(colleges) or '(none yet)'}\n\n"
        f"=== Intended Majors ===\n{', '.join(majors) or '(undecided)'}"
    )

    raw = complete(SYSTEM_PROMPT, user_message, max_tokens=2200)
    if not raw:
        raise RuntimeError("The language model didn't respond. Check GROQ_API_KEY in .env at the project root.")
    try:
        data = parse_json(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        print(f"[analysis] Could not parse model output: {exc}\n{raw[:800]}")
        raise RuntimeError("The analysis came back in an unexpected format. Please try again.") from exc

    return _normalize(data, colleges)
