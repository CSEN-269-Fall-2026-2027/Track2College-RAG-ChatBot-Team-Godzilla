"""
Profile analysis: grounds an LLM review of a student's profile and college
list in passages retrieved from the knowledge base, and returns structured JSON
for the frontend's Insights page.
"""

import json

from llm_utils import allowed_sources, collect_context, parse_json, strings
from query import complete

MAX_COLLEGES = 8
PASSAGES_PER_COLLEGE = 3
GENERAL_QUERIES = (
    "freshman application checklist and deadlines",
    "financial aid FAFSA and scholarships for incoming students",
)
FITS = {"reach", "target", "likely", "unknown"}

SYSTEM_PROMPT = """\
You are a careful college counselor for the Track2College platform. You review one
student's profile and college list.

RULES:
1. Facts about colleges (requirements, GPA expectations, deadlines, programs, costs) must come
   ONLY from the CONTEXT PASSAGES. If the passages don't cover a college, set its fit to
   "unknown" and say what the student should look up.
2. Facts about the student come only from the STUDENT PROFILE. Never invent grades, scores, or
   activities. If something important is missing from the profile, list it under "gaps".
3. Fit labels: "reach", "target", "likely", or "unknown". Be honest but encouraging; never
   promise admission.
4. Each college's "sources" may contain only URLs that appear in the CONTEXT PASSAGES.
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


def _normalize(data: dict, colleges: list[str], allowed_urls: set[str]) -> dict:
    college_rows = []
    for row in data.get("colleges") or []:
        if not isinstance(row, dict) or not str(row.get("name", "")).strip():
            continue
        fit = str(row.get("fit", "unknown")).strip().lower()
        college_rows.append({
            "name": str(row["name"]).strip(),
            "fit": fit if fit in FITS else "unknown",
            "reasoning": str(row.get("reasoning", "")).strip(),
            "sources": allowed_sources(row.get("sources"), allowed_urls, 3),
        })

    covered = {row["name"].lower() for row in college_rows}
    for name in colleges:
        if name.lower() not in covered:
            college_rows.append({
                "name": name,
                "fit": "unknown",
                "reasoning": "There isn't enough information about this school in the knowledge base yet.",
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
    colleges = [c.strip() for c in colleges if c.strip()]
    major_hint = f" {majors[0]}" if majors else ""
    queries = [(f"{name} freshman admission requirements{major_hint}", name) for name in colleges[:MAX_COLLEGES]]
    queries += [(q, "General") for q in GENERAL_QUERIES]
    context, allowed_urls = collect_context(queries, PASSAGES_PER_COLLEGE)

    user_message = (
        f"=== Student Profile ===\n{profile_summary.strip() or '(empty)'}\n\n"
        f"=== College List ===\n{', '.join(colleges) or '(none yet)'}\n\n"
        f"=== Context Passages ===\n{context or '(no relevant passages found)'}"
    )

    raw = complete(SYSTEM_PROMPT, user_message, max_tokens=2200)
    if not raw:
        raise RuntimeError("The language model didn't respond. Make sure Ollama (or your RunPod endpoint) is running.")
    try:
        data = parse_json(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        print(f"[analysis] Could not parse model output: {exc}\n{raw[:800]}")
        raise RuntimeError("The analysis came back in an unexpected format. Please try again.") from exc

    return _normalize(data, colleges, allowed_urls)
