"""
Transcript analysis: extracts text from an uploaded transcript (PDF / TXT / CSV),
has the LLM structure it into courses, and returns brief feedback. GPA and A–G
math is done by the frontend from the structured courses, not by the model.
"""

import base64
import binascii
import io
import json

from pypdf import PdfReader

from llm_utils import parse_json, strings, text
from query import complete

MAX_BYTES = 5 * 1024 * 1024
MAX_TEXT_CHARS = 14000
MIN_TEXT_CHARS = 40
LEVELS = {"regular", "honors", "ap", "ib", "dual-enrollment"}
AREAS = {"a", "b", "c", "d", "e", "f", "g", "none"}
GRADE_LEVELS = {"9", "10", "11", "12", "other"}


class TranscriptError(ValueError):
    """A problem with the uploaded file that the student can fix."""


SYSTEM_PROMPT = """\
You read US high school transcripts and convert them to structured data.

RULES:
1. Extract EVERY course row exactly as listed. Never invent courses or grades.
2. One entry per course per grading period as shown. If a full-year course has a single final
   grade, use one entry with "semesters": 2. A semester grade is "semesters": 1.
3. "grade_level": "9", "10", "11", "12", or "other" (middle school, summer, college).
4. "grade": the letter grade as written (e.g. "A-", "B+", "P"). Use "" if in progress.
5. "level": "ap" for AP, "ib" for IB, "dual-enrollment" for college courses, "honors" for
   honors/advanced, otherwise "regular".
6. "area": the University of California A–G subject area:
   a = history/social science, b = English, c = mathematics, d = laboratory science,
   e = language other than English, f = visual & performing arts, g = college-prep elective,
   none = PE, health, study hall, TA, and other non-academic courses.
7. "reported_gpa": copy GPAs printed on the transcript, else "".
8. Feedback ("summary", "strengths", "concerns") must be based only on the transcript: course
   rigor, grade trends, gaps in A–G subjects. Plain, encouraging language for a student.

Respond with ONLY a JSON object, no markdown fences:
{
  "student_name": "", "school": "",
  "reported_gpa": {"unweighted": "", "weighted": ""},
  "courses": [{"name": "", "grade_level": "10", "term": "Fall", "grade": "A", "level": "regular", "area": "b", "semesters": 1}],
  "summary": "2-3 sentences", "strengths": ["..."], "concerns": ["..."]
}
"""


def _decode(content_base64: str) -> bytes:
    try:
        data = base64.b64decode(content_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise TranscriptError("The file couldn't be read. Please upload it again.") from exc
    if len(data) > MAX_BYTES:
        raise TranscriptError("That file is larger than 5 MB.")
    return data


def extract_text(file_name: str, mime_type: str, content_base64: str) -> str:
    data = _decode(content_base64)
    name = file_name.lower()
    if name.endswith(".pdf") or mime_type == "application/pdf":
        try:
            reader = PdfReader(io.BytesIO(data))
            raw = "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception as exc:
            raise TranscriptError("That PDF couldn't be opened. Is it password-protected?") from exc
    elif name.endswith((".txt", ".csv", ".md")) or mime_type.startswith("text/"):
        # .md is accepted even when the browser leaves MIME empty.
        raw = data.decode("utf-8", errors="replace")
    else:
        raise TranscriptError("Upload a PDF, TXT, CSV, or Markdown (.md) file.")

    cleaned = "\n".join(line.strip() for line in raw.splitlines() if line.strip())
    if len(cleaned) < MIN_TEXT_CHARS:
        raise TranscriptError(
            "We couldn't find any text in that file. If it's a scanned image, download the "
            "transcript as a PDF from your school portal instead."
        )
    return cleaned[:MAX_TEXT_CHARS]


def _course(row: dict) -> dict | None:
    name = text(row.get("name"))
    if not name:
        return None
    level = text(row.get("level")).lower()
    area = text(row.get("area")).lower()
    grade_level = text(row.get("grade_level"))
    try:
        semesters = max(1, min(2, int(row.get("semesters") or 1)))
    except (TypeError, ValueError):
        semesters = 1
    return {
        "name": name,
        "grade_level": grade_level if grade_level in GRADE_LEVELS else "other",
        "term": text(row.get("term")),
        "grade": text(row.get("grade"))[:4],
        "level": level if level in LEVELS else "regular",
        "area": area if area in AREAS else "none",
        "semesters": semesters,
    }


def analyze_transcript(file_name: str, mime_type: str, content_base64: str) -> dict:
    transcript_text = extract_text(file_name, mime_type, content_base64)
    raw = complete(SYSTEM_PROMPT, f"=== Transcript ===\n{transcript_text}", max_tokens=6000)
    if not raw:
        raise RuntimeError("The language model didn't respond. Make sure Ollama (or your RunPod endpoint) is running.")
    try:
        data = parse_json(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        print(f"[transcript] Could not parse model output: {exc}\n{raw[:800]}")
        raise RuntimeError("We couldn't make sense of that transcript. Please try again.") from exc

    courses = [c for c in (_course(row) for row in data.get("courses") or [] if isinstance(row, dict)) if c]
    if not courses:
        raise TranscriptError("We couldn't find any courses in that file. Is it a high school transcript?")

    gpa = data.get("reported_gpa") if isinstance(data.get("reported_gpa"), dict) else {}
    return {
        "student_name": text(data.get("student_name")),
        "school": text(data.get("school")),
        "reported_gpa": {"unweighted": text(gpa.get("unweighted")), "weighted": text(gpa.get("weighted"))},
        "courses": courses,
        "summary": text(data.get("summary")),
        "strengths": strings(data.get("strengths"), 5),
        "concerns": strings(data.get("concerns"), 5),
    }
