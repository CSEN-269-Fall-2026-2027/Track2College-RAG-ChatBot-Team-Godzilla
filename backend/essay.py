"""
Essay coach: drafts a personal statement or brainstorms topic ideas from the
student's profile and a prompt they provide (e.g. a Common App prompt).
"""

import json

from llm_utils import parse_json, strings, text
from query import complete

SYSTEM_PROMPT = """\
You are a college essay coach for high school students on the Track2College platform.

RULES:
1. Use ONLY details from the STUDENT PROFILE and the ESSAY PROMPT. Do not invent awards,
   activities, grades, family stories, or hardships that are not in the profile.
2. If the profile is thin, say what is missing and still give useful angles based on what you have.
3. Write in a natural teen/young-adult voice — specific and reflective, not corporate or cliché.
4. Never claim the essay is ready to submit unchanged; frame drafts as starting points.
5. When mode is "ideas", return 3–5 distinct topic angles. When mode is "draft", write one essay
   of roughly 450–650 words that answers the prompt, plus a short title.

Respond with ONLY a JSON object, no markdown fences:
{
  "title": "short title for the draft or idea set",
  "essay": "full draft when mode is draft; empty string when mode is ideas",
  "ideas": [{"title": "", "angle": "", "why_it_fits": ""}],
  "tips": ["revision tip..."]
}
"""


def generate_essay(prompt: str, profile_summary: str, mode: str) -> dict:
    mode = "ideas" if mode == "ideas" else "draft"
    user_message = (
        f"=== Mode ===\n{mode}\n\n"
        f"=== Essay Prompt ===\n{prompt.strip()}\n\n"
        f"=== Student Profile ===\n{profile_summary.strip() or '(empty — ask the student to fill their profile)'}"
    )
    raw = complete(SYSTEM_PROMPT, user_message, max_tokens=3500)
    if not raw:
        raise RuntimeError("The language model didn't respond. Check GROQ_API_KEY in backend/.env.")
    try:
        data = parse_json(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        print(f"[essay] Could not parse model output: {exc}\n{raw[:800]}")
        raise RuntimeError("The essay response came back in an unexpected format. Please try again.") from exc

    ideas = []
    for row in data.get("ideas") or []:
        if not isinstance(row, dict):
            continue
        title = text(row.get("title"))
        angle = text(row.get("angle"))
        if title or angle:
            ideas.append(
                {
                    "title": title,
                    "angle": angle,
                    "why_it_fits": text(row.get("why_it_fits")),
                }
            )

    essay = text(data.get("essay")) if mode == "draft" else ""
    return {
        "title": text(data.get("title")),
        "essay": essay,
        "ideas": ideas[:6],
        "tips": strings(data.get("tips"), 6),
    }
