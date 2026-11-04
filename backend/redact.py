"""
Keeps secrets out of the backend console and debug files.

A UC run registers the secrets it holds (the student's UC password, the cloud browser's connect URL)
for its own thread; every line the run prints, every status detail it reports, and every debug page
it saves goes through redact() first. Key-like URL parameters are masked everywhere, registered or not.
"""

from __future__ import annotations

import re
import threading

MASK = "[redacted]"
# signingKey / apiKey / token style query parameters, e.g. Browserbase's wss://…?signingKey=…
_URL_SECRET = re.compile(r"((?:signing_?key|api_?key|access_?token|token|key|password)=)[^&\s'\"<>]+", re.I)
# A password input's value attribute in saved HTML.
_PASSWORD_VALUE = re.compile(r"(<input\b[^>]*\btype=[\"']?password[\"']?[^>]*\bvalue=)([\"'])[^\"']*\2", re.I)

_local = threading.local()


def remember(*secrets: str | None) -> None:
    """Adds secrets that this thread must never print."""
    current = getattr(_local, "secrets", ())
    _local.secrets = current + tuple(s for s in secrets if s)


def forget_all() -> None:
    _local.secrets = ()


def redact(text: object) -> str:
    out = str(text)
    # Longest first, so a secret that contains another is masked whole.
    for secret in sorted(getattr(_local, "secrets", ()), key=len, reverse=True):
        out = out.replace(secret, MASK)
    out = _URL_SECRET.sub(rf"\1{MASK}", out)
    return _PASSWORD_VALUE.sub(rf"\1\2{MASK}\2", out)
