#!/usr/bin/env python3
"""Validate the SEC-01 build-time OpenAPI contract."""

from __future__ import annotations

import json
import sys
from pathlib import Path


def fail(message: str) -> None:
    print(f"SEC-01 OpenAPI verification failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: verify-openapi.py <openapi.json>")

    path = Path(sys.argv[1])
    if not path.is_file():
        fail(f"document is missing: {path}")
    if path.stat().st_size == 0:
        fail(f"document is empty: {path}")

    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        fail(f"document is not valid UTF-8 JSON: {exc}")

    version = document.get("openapi")
    if not isinstance(version, str) or not version.startswith("3.1."):
        fail(f"expected OpenAPI 3.1.x, got {version!r}")

    paths = document.get("paths")
    if not isinstance(paths, dict) or not paths:
        fail("document must contain at least one path")

    print(
        "SEC-01 OpenAPI verification passed: "
        f"version={version}, paths={len(paths)}, bytes={path.stat().st_size}"
    )


if __name__ == "__main__":
    main()
