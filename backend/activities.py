"""Normalize Google activity suggestions to the UC field limits."""

import re

from llm_utils import text

DESCRIPTION_LIMIT = 350
MAX_ITEMS = 10

AWARD_LEVELS = {"school", "regional", "state", "national", "international"}

def _fit(description: str) -> str:
    """Cut to the limit, at the end of a sentence when one fits."""
    if len(description) <= DESCRIPTION_LIMIT:
        return description
    cut = description[:DESCRIPTION_LIMIT]
    sentences = re.match(r"^(.*[.!?])(?:\s|$)", cut, re.DOTALL)
    return sentences.group(1) if sentences else cut.rstrip()


def clean_items(data: dict) -> list[dict[str, str]]:
    """Keep the model's entries that have a name, within the field limits, without repeats."""
    items = data.get("activities")
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        name = text(item.get("name"))[:100]
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        level = text(item.get("level")).lower()
        out.append({
            "name": name,
            "role": text(item.get("role"))[:100],
            "description": _fit(text(item.get("description"))),
            "level": level if level in AWARD_LEVELS else "",
        })
    return out[:MAX_ITEMS]
