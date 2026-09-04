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
MOBILE_PATTERN = re.compile(r"width\s*:\s*320|\bchromium-mobile\b")
TEST_START_PATTERN = re.compile(
    r"(?m)^(?P<indent>[ \t]*)test(?:\.(?:only|skip|fixme|fail))?\s*\("
)


def extract_required_test_block(source: str, title_fragment: str) -> tuple[str | None, str | None]:
    """Return the concrete Playwright test containing a unique required title."""

    title_occurrences = [match.start() for match in re.finditer(re.escape(title_fragment), source)]
    if len(title_occurrences) != 1:
        return None, f"required title fragment must occur exactly once, found {len(title_occurrences)}"

    title_index = title_occurrences[0]
    test_starts = [match for match in TEST_START_PATTERN.finditer(source, 0, title_index)]
    if not test_starts:
        return None, "required title is not inside a concrete Playwright test() call"

    test_start = test_starts[-1]
    indent = test_start.group("indent")
    test_end_pattern = re.compile(rf"(?m)^{re.escape(indent)}\}}\);\s*$")
    test_end = test_end_pattern.search(source, title_index)
    if test_end is None:
        return None, "required Playwright test() call has no matching same-indent closing line"

    block = source[test_start.start() : test_end.end()]
    if title_fragment not in block:
        return None, "required title could not be bound to its Playwright test() body"
    return block, None


def runner_registers(runner_source: str, relative_path: str) -> bool:
    """Require an executable-looking static-suite entry, not a comment/token hit."""

    return re.search(
        rf"(?m)^\s*['\"]{re.escape(relative_path)}['\"],?\s*$",
        runner_source,
    ) is not None


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
        test_block, extraction_error = extract_required_test_block(source, title_fragment)
        if extraction_error is not None or test_block is None:
            errors.append(
                f"{relative_path}: required {area} test is not structurally bound: {extraction_error}"
            )
        else:
            if "expectNoAccessibilityViolations" not in test_block:
                errors.append(
                    f"{relative_path}: required {area} test body no longer contains axe accessibility coverage"
                )
            if not MOBILE_PATTERN.search(test_block):
                errors.append(
                    f"{relative_path}: required {area} test body no longer contains a 320px/mobile execution path"
                )

        if not runner_registers(runner_source, relative_path):
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
        f"{required_count} required test bodies cover {len(REQUIRED_AREAS)} MVP-A areas, "
        "contain local accessibility/mobile evidence, and are registered in the canonical Playwright suite."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
