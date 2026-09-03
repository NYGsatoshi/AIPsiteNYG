#!/usr/bin/env python3
"""Validate the SEC-01 build-time OpenAPI contract."""

from __future__ import annotations

import json
import sys
from pathlib import Path


def fail(message: str) -> None:
    print(f"SEC-01 OpenAPI verification failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def require_wire_schema(
    schemas: dict[str, object],
    name: str,
    expected_types: set[str],
    expected_format: str | None = None,
) -> None:
    schema = schemas.get(name)
    if not isinstance(schema, dict) or not schema:
        fail(f"component schema {name!r} must be present and non-empty")

    raw_types = schema.get("type")
    if isinstance(raw_types, str):
        actual_types = {raw_types}
    elif isinstance(raw_types, list) and all(isinstance(item, str) for item in raw_types):
        actual_types = set(raw_types)
    else:
        fail(f"component schema {name!r} has invalid type {raw_types!r}")

    if actual_types != expected_types:
        fail(
            f"component schema {name!r} must expose wire types "
            f"{sorted(expected_types)!r}, got {sorted(actual_types)!r}"
        )

    actual_format = schema.get("format")
    if actual_format != expected_format:
        fail(
            f"component schema {name!r} must expose format "
            f"{expected_format!r}, got {actual_format!r}"
        )


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

    components = document.get("components")
    schemas = components.get("schemas") if isinstance(components, dict) else None
    if not isinstance(schemas, dict):
        fail("document must contain component schemas")

    # These PATCH sentinel structs use custom System.Text.Json converters. Their
    # OpenAPI representation must match the JSON wire format, not the CLR shape;
    # otherwise Schemathesis/ZAP would fuzz them as unconstrained objects.
    require_wire_schema(
        schemas,
        "OptionalDateTimeOffset",
        {"null", "string"},
        "date-time",
    )
    require_wire_schema(schemas, "OptionalString", {"null", "string"})

    print(
        "SEC-01 OpenAPI verification passed: "
        f"version={version}, paths={len(paths)}, bytes={path.stat().st_size}"
    )


if __name__ == "__main__":
    main()
