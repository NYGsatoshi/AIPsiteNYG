#!/usr/bin/env python3
"""Fail closed if required MVP-A accessibility browser coverage disappears."""

from __future__ import annotations

import re
import sys
from pathlib import Path

MANIFEST = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("scripts/ci/mvp-a-required-a11y-tests.txt")
RUNNER = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("tests/ui/run-angular-playwright.mjs")
REQUIRED_AREAS = (
    "Workspace",
    "Project / Task",
    "Files",
    "Message",
    "Audit",
    "Announcement",
)
MOBILE_PATTERN = re.compile(r"width\s*:\s*320|chromium-mobile")


def main() -> int:
    errors: list[str] = []
    seen_areas: set[str] = set()
    required_count = 0

    if not MANIFEST.is_file():
        print(f"MVP-A accessibility manifest is missing: {MANIFEST}", file=sys.stderr)
        return 1
    if not RUNNER.is_file():
        print(f"Canonical Angular Playwright runner is missing: {RUNNER}", file=sys.stderr)
        return 1

    runner_source = RUNNER.read_text(encoding="utf-8")
    for line_number, raw_line in enumerate(MANIFEST.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        fields = [value.strip() for value in line.split("|")]
        if len(fields) != 3 or any(not value for value in fields):
            errors.append(
                f"{MANIFEST}:{line_number}: expected <area>|<spec path>|<required title fragment>"
            )
            continue

        area, relative_path, title_fragment = fields
        required_count += 1
        if area in seen_areas:
            errors.append(f"{MANIFEST}:{line_number}: duplicate area {area!r}")
        seen_areas.add(area)

        spec_path = Path(relative_path)
        if not spec_path.is_file():
            errors.append(f"{relative_path}: required spec for {area} is missing")
            continue

        source = spec_path.read_text(encoding="utf-8")
        if title_fragment not in source:
            errors.append(
                f"{relative_path}: required {area} test title fragment is missing: {title_fragment!r}"
            )
        if "expectNoAccessibilityViolations" not in source:
            errors.append(
                f"{relative_path}: required {area} spec no longer contains axe accessibility coverage"
            )
        if not MOBILE_PATTERN.search(source):
            errors.append(
                f"{relative_path}: required {area} spec no longer contains a 320px/mobile execution path"
            )
        if f"'{relative_path}'" not in runner_source and f'"{relative_path}"' not in runner_source:
            errors.append(
                f"{RUNNER}: required {area} spec is not registered in the canonical Angular Playwright suite: {relative_path}"
            )

    if required_count == 0:
        errors.append(f"{MANIFEST}: manifest contains no required tests")

    for area in REQUIRED_AREAS:
        if area not in seen_areas:
            errors.append(f"{MANIFEST}: required MVP-A area is missing: {area}")

    if errors:
        print("MVP-A accessibility required-test policy failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(
        "MVP-A accessibility required-test policy passed: "
        f"{required_count} required tests cover {len(REQUIRED_AREAS)} MVP-A areas "
        "and are registered in the canonical Playwright suite."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
