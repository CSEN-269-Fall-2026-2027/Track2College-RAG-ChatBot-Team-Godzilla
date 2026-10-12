"""Shared helpers for features that ask the LLM for structured JSON grounded in retrieved passages."""

import json
import re

from query import RELEVANCE_THRESHOLD, get_query_embedding, search_collection


def retrieve(query: str, limit: int) -> list[tuple[str, str]]:
    """Return (url, text) for passages above the relevance threshold."""
    results = search_collection(get_query_embedding(query), limit)
    passages = []
    for doc, meta, distance in zip(results["documents"][0], results["metadatas"][0], results["distances"][0]):
        if 1.0 - distance >= RELEVANCE_THRESHOLD and doc.strip():
            passages.append((meta.get("url", "").strip(), doc.strip()))
    return passages


def collect_context(queries: list[tuple[str, str]], per_query: int) -> tuple[str, set[str]]:
    """Run (query, label) retrievals and return a numbered context block plus the allowlist of URLs it contains."""
    seen: set[str] = set()
    blocks: list[str] = []
    urls: set[str] = set()
    for query, label in queries:
        for url, text in retrieve(query, per_query):
            key = text[:200]
            if key in seen:
                continue
            seen.add(key)
            if url:
                urls.add(url.lower().rstrip("/"))
            blocks.append(f"--- Passage {len(blocks) + 1} (retrieved for: {label}) ---\nURL: {url or 'n/a'}\n{text}\n")
    return "\n".join(blocks), urls


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


def allowed_sources(value, allowlist: set[str], limit: int = 4) -> list[str]:
    return [u for u in strings(value, limit * 2) if u.lower().rstrip("/") in allowlist][:limit]
