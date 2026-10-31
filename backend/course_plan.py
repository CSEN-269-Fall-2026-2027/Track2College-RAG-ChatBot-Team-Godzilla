"""
Course planning: grade 9–12 plan aimed at a UC campus.
Uses Groq + A–G knowledge — no vector knowledge base.
"""

import json

from llm_utils import allowed_sources, parse_json, strings, text
from query import complete

LEVELS = {"regular", "honors", "ap", "ib", "dual-enrollment"}
AREAS = {"a", "b", "c", "d", "e", "f", "g", "none"}
GRADES = ("9", "10", "11", "12")

SYSTEM_PROMPT = """\
You are a high school course-planning counselor for the Track2College platform.

RULES:
1. Target University of California freshman admission. Use UC/CSU A–G minimums as a baseline
   (a 2 yrs History, b 4 English, c 3 Math, d 2 Lab Science, e 2 Language, f 1 Visual/Performing Arts, g 1 College Elective).
   Prefer universityofcalifornia.edu guidance; if unsure, say the student should confirm with a counselor.
2. Include every COMPLETED COURSE in its grade with "status": "completed". Never change them.
3. For the current grade and later, add "planned" courses that meet A–G and strengthen the
   application for the intended major. Use generic names a school would offer
   ("AP Biology", "Spanish 3", "Precalculus Honors"), 5–7 academic courses per year.
4. Don't plan courses for grades the student has already finished unless they're listed.
5. "note" is optional and short: why the course matters for this UC campus or major.
6. "sources" may include well-known official URLs only (e.g. https://admission.universityofcalifornia.edu/).

Respond with ONLY a JSON object, no markdown fences:
{
  "summary": "2-3 sentences on the strategy",
  "requirements": [{"area": "Math", "detail": "what this college expects"}],
  "years": [{"grade": "9", "courses": [{"name": "", "area": "c", "level": "regular", "status": "completed", "note": ""}]}],
  "tips": ["..."],
  "sources": ["https://..."]
}
"years" must contain grades 9, 10, 11, and 12 in order.
"""


def _course(row: dict) -> dict | None:
    name = text(row.get("name"))
    if not name:
        return None
    level, area, status = (text(row.get(k)).lower() for k in ("level", "area", "status"))
    return {
        "name": name,
        "area": area if area in AREAS else "none",
        "level": level if level in LEVELS else "regular",
        "status": "completed" if status == "completed" else "planned",
        "note": text(row.get("note")),
    }


def _completed_block(courses: list[dict]) -> str:
    if not courses:
        return "(none provided)"
    lines = []
    for grade in (*GRADES, "other"):
        rows = [c for c in courses if c.get("grade_level") == grade]
        if rows:
            listed = "; ".join(
                f"{c['name']} [{c.get('level', 'regular')}, area {c.get('area', 'none')}, grade {c.get('grade') or 'in progress'}]"
                for c in rows
            )
            lines.append(f"Grade {grade}: {listed}")
    return "\n".join(lines)


def build_course_plan(college: str, major: str, grade_level: str, completed: list[dict], profile_summary: str) -> dict:
    user_message = (
        f"=== Target UC Campus ===\n{college}\n\n"
        f"=== Intended Major ===\n{major or '(undecided)'}\n\n"
        f"=== Current Grade ===\n{grade_level or '(unknown; assume the student is entering 9th grade)'}\n\n"
        f"=== Completed Courses ===\n{_completed_block(completed)}\n\n"
        f"=== Student Profile ===\n{profile_summary.strip() or '(empty)'}"
    )

    raw = complete(SYSTEM_PROMPT, user_message, max_tokens=4000)
    if not raw:
        raise RuntimeError("The language model didn't respond. Check GROQ_API_KEY in backend/.env.")
    try:
        data = parse_json(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        print(f"[course-plan] Could not parse model output: {exc}\n{raw[:800]}")
        raise RuntimeError("The course plan came back in an unexpected format. Please try again.") from exc

    by_grade = {}
    for year in data.get("years") or []:
        if isinstance(year, dict) and text(year.get("grade")) in GRADES:
            by_grade[text(year["grade"])] = [
                c for c in (_course(r) for r in year.get("courses") or [] if isinstance(r, dict)) if c
            ]

    requirements = [
        {"area": text(r.get("area")), "detail": text(r.get("detail"))}
        for r in data.get("requirements") or []
        if isinstance(r, dict) and text(r.get("detail"))
    ]

    return {
        "summary": text(data.get("summary")),
        "requirements": requirements[:10],
        "years": [{"grade": g, "courses": by_grade.get(g, [])} for g in GRADES],
        "tips": strings(data.get("tips"), 6),
        "sources": allowed_sources(data.get("sources"), None, 4),
    }
