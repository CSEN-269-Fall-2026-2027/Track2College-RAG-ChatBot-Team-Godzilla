"""Shared helpers for features that ask the LLM for structured JSON."""

import json
import re


def parse_json(text: str) -> dict:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("model did not return a JSON object")
    return json.loads(cleaned[start : end + 1])


def strings(value, limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()][:limit]


def text(value) -> str:
    return str(value).strip() if value is not None else ""


def allowed_sources(value, allowlist: set[str] | None = None, limit: int = 4) -> list[str]:
    """Keep URL-looking strings. Allowlist is optional now that retrieval is gone."""
    urls = strings(value, limit * 2)
    if allowlist:
        urls = [u for u in urls if u.lower().rstrip("/") in allowlist]
    return [
        u
        for u in urls
        if u.startswith("http://") or u.startswith("https://")
    ][:limit]
