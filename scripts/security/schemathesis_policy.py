#!/usr/bin/env python3
"""SEC-04 response-disclosure policy shared by Schemathesis hooks and tests."""

from __future__ import annotations

import re
from collections.abc import Iterable

_DISCLOSURE_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("dotnet-exception", re.compile(r"\b(?:System\.)?[A-Z][A-Za-z0-9_.`+]*Exception\b")),
    ("dotnet-stack", re.compile(r"(?m)^\s*at\s+[A-Za-z0-9_.`+<>]+\([^\n]*\)(?:\s+in\s+[^\n]+:line\s+\d+)?\s*$")),
    ("python-traceback", re.compile(r"Traceback \(most recent call last\):")),
    ("ef-core-internal", re.compile(r"\bMicrosoft\.EntityFrameworkCore(?:\.|\b)")),
    ("npgsql-internal", re.compile(r"\bNpgsql(?:\.|Exception\b)")),
    ("sqlstate", re.compile(r"\bSQLSTATE\b", re.IGNORECASE)),
    ("stack-trace-field", re.compile(r'(?i)["\']stack(?:trace)?["\']\s*:')),
)


def disclosure_reason(content: bytes, forbidden_values: Iterable[str] = ()) -> str | None:
    """Return a non-secret reason when a response discloses internals or auth material."""

    text = content.decode("utf-8", errors="replace")
    for value in forbidden_values:
        if len(value) >= 8 and value in text:
            return "ephemeral-auth-material"

    for name, pattern in _DISCLOSURE_PATTERNS:
        if pattern.search(text):
            return name
    return None
