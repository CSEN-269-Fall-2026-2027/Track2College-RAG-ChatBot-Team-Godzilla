"""
Course planning: builds a grade 9–12 course plan for a target college,
grounded in that college's requirement pages from the knowledge base and the
student's completed courses.
"""

import json

from llm_utils import allowed_sources, collect_context, parse_json, strings, text
from query import complete

LEVELS = {"regular", "honors", "ap", "ib", "dual-enrollment"}
AREAS = {"a", "b", "c", "d", "e", "f", "g", "none"}
GRADES = ("9", "10", "11", "12")

SYSTEM_PROMPT = """\
You are a high school course-planning counselor for the Track2College platform.

RULES:
1. College requirements and recommendations must come ONLY from the CONTEXT PASSAGES. If the
   passages don't state something, don't claim it; say the student should confirm it.
   UC/CSU A–G minimums (a 2 yrs, b 4, c 3, d 2, e 2, f 1, g 1) may be used as a baseline.
2. Include every COMPLETED COURSE in its grade with "status": "completed". Never change them.
3. For the current grade and later, add "planned" courses that meet the requirements and
   strengthen the application for the intended major. Use generic names a school would offer
   ("AP Biology", "Spanish 3", "Precalculus Honors"), 5–7 academic courses per year.
4. Don't plan courses for grades the student has already finished unless they're listed.
5. "note" is optional and short: why the course matters for this college or major.
6. "sources" may contain only URLs that appear in the CONTEXT PASSAGES.

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
    major_hint = f" {major}" if major else ""
    queries = [
        (f"{college} freshman admission requirements high school courses", college),
        (f"{college} recommended high school preparation{major_hint}", college),
        ("A-G subject requirements UC CSU high school courses", "A–G requirements"),
    ]
    if major:
        queries.append((f"{major} major prerequisites high school math science preparation", major))
    context, allowed_urls = collect_context(queries, 4)

    user_message = (
        f"=== Target College ===\n{college}\n\n"
        f"=== Intended Major ===\n{major or '(undecided)'}\n\n"
        f"=== Current Grade ===\n{grade_level or '(unknown; assume the student is entering 9th grade)'}\n\n"
        f"=== Completed Courses ===\n{_completed_block(completed)}\n\n"
        f"=== Student Profile ===\n{profile_summary.strip() or '(empty)'}\n\n"
        f"=== Context Passages ===\n{context or '(no relevant passages found)'}"
    )

    raw = complete(SYSTEM_PROMPT, user_message, max_tokens=4000)
    if not raw:
        raise RuntimeError("The language model didn't respond. Make sure Ollama (or your RunPod endpoint) is running.")
    try:
        data = parse_json(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        print(f"[course-plan] Could not parse model output: {exc}\n{raw[:800]}")
        raise RuntimeError("The course plan came back in an unexpected format. Please try again.") from exc

    by_grade = {}
    for year in data.get("years") or []:
        if isinstance(year, dict) and text(year.get("grade")) in GRADES:
            by_grade[text(year["grade"])] = [c for c in (_course(r) for r in year.get("courses") or [] if isinstance(r, dict)) if c]

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
        "sources": allowed_sources(data.get("sources"), allowed_urls, 4),
    }
