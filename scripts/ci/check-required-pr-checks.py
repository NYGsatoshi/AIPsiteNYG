#!/usr/bin/env python3
"""Fail closed when required pull-request checks can be skipped."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
POLICY_PATH = ROOT / "governance" / "policy.json"
REQUIRED_CHECKS_CONTROL_ID = "GOV-CHECKS-001"


def load_required_pr_checks(
    policy_path: Path = POLICY_PATH,
) -> dict[str, tuple[str, ...]]:
    """Load required PR workflow jobs from the Governance policy source of truth."""
    try:
        policy: Any = json.loads(policy_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"unable to load governance policy: {exc}") from exc

    controls = policy.get("controls") if isinstance(policy, dict) else None
    if not isinstance(controls, list):
        raise RuntimeError("governance policy controls must be an array")

    matches = [
        control
        for control in controls
        if isinstance(control, dict)
        and control.get("id") == REQUIRED_CHECKS_CONTROL_ID
    ]
    if len(matches) != 1:
        raise RuntimeError(
            f"governance policy must define exactly one {REQUIRED_CHECKS_CONTROL_ID} control"
        )

    control = matches[0]
    if control.get("family") != "required-status-checks":
        raise RuntimeError(
            f"{REQUIRED_CHECKS_CONTROL_ID} must use family 'required-status-checks'"
        )

    expected = control.get("expected")
    required = expected.get("required") if isinstance(expected, dict) else None
    if not isinstance(required, list) or not required:
        raise RuntimeError(
            f"{REQUIRED_CHECKS_CONTROL_ID}.expected.required must be a non-empty array"
        )

    result: dict[str, list[str]] = {}
    for index, item in enumerate(required):
        if not isinstance(item, dict):
            raise RuntimeError(
                f"{REQUIRED_CHECKS_CONTROL_ID}.expected.required[{index}] must be an object"
            )
        workflow = item.get("workflow")
        job = item.get("job")
        context = item.get("context")
        if (
            not isinstance(workflow, str)
            or not workflow
            or not isinstance(job, str)
            or not job
            or not isinstance(context, str)
            or not context
        ):
            raise RuntimeError(
                f"{REQUIRED_CHECKS_CONTROL_ID}.expected.required[{index}] "
                "must define non-empty workflow/job/context"
            )
        if context != job:
            raise RuntimeError(
                f"{REQUIRED_CHECKS_CONTROL_ID}.expected.required[{index}] "
                f"context {context!r} must equal repository job name {job!r}"
            )
        result.setdefault(workflow, []).append(job)

    return {workflow: tuple(jobs) for workflow, jobs in result.items()}


REQUIRED_PR_CHECKS = load_required_pr_checks()


def _without_comment(line: str) -> str:
    quote: str | None = None
    escaped = False
    result: list[str] = []
    for char in line:
        if escaped:
            result.append(char)
            escaped = False
            continue
        if char == "\\" and quote == '"':
            result.append(char)
            escaped = True
            continue
        if char in {"'", '"'}:
            if quote is None:
                quote = char
            elif quote == char:
                quote = None
            result.append(char)
            continue
        if char == "#" and quote is None:
            break
        result.append(char)
    return "".join(result)


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip())


def _clean_lines(text: str) -> list[str]:
    return [_without_comment(line).rstrip() for line in text.splitlines()]


def has_unfiltered_event(text: str, event: str) -> bool:
    """Return True only when ``event`` is enabled without event-level filters."""
    lines = _clean_lines(text)
    event_token = re.compile(
        rf"(^|[\s,\[])[\"']?{re.escape(event)}[\"']?(?=$|[\s,\]])"
    )

    for on_index, line in enumerate(lines):
        match = re.match(r"^(?:on|'on'|\"on\")\s*:\s*(.*)$", line)
        if not match:
            continue

        inline = match.group(1).strip()
        if inline:
            return bool(event_token.search(inline))

        on_indent = _indent(line)
        nested_indexes: list[int] = []
        for index in range(on_index + 1, len(lines)):
            candidate = lines[index]
            if not candidate.strip():
                continue
            if _indent(candidate) <= on_indent:
                break
            nested_indexes.append(index)
        if not nested_indexes:
            return False

        event_indent = min(_indent(lines[index]) for index in nested_indexes)
        event_pattern = re.compile(
            rf"^[\"']?{re.escape(event)}[\"']?\s*:\s*(.*)$"
        )
        for event_index in nested_indexes:
            candidate = lines[event_index]
            if _indent(candidate) != event_indent:
                continue
            event_match = event_pattern.match(candidate.strip())
            if not event_match:
                continue
            if event_match.group(1).strip():
                return False
            for nested_index in range(event_index + 1, len(lines)):
                nested = lines[nested_index]
                if not nested.strip():
                    continue
                if _indent(nested) <= event_indent:
                    break
                return False
            return True
        return False
    return False


def _job_blocks(text: str) -> dict[str, tuple[int, int, int]]:
    lines = _clean_lines(text)
    jobs_index: int | None = None
    jobs_indent = 0
    for index, line in enumerate(lines):
        if re.match(r"^jobs\s*:\s*$", line):
            jobs_index = index
            jobs_indent = _indent(line)
            break
    if jobs_index is None:
        return {}

    nested_indexes: list[int] = []
    for index in range(jobs_index + 1, len(lines)):
        line = lines[index]
        if not line.strip():
            continue
        if _indent(line) <= jobs_indent:
            break
        nested_indexes.append(index)
    if not nested_indexes:
        return {}

    job_indent = min(_indent(lines[index]) for index in nested_indexes)
    starts: list[tuple[int, str]] = []
    for index in nested_indexes:
        line = lines[index]
        if _indent(line) != job_indent:
            continue
        match = re.match(r"^([A-Za-z0-9_.-]+)\s*:\s*$", line.strip())
        if match:
            starts.append((index, match.group(1)))

    result: dict[str, tuple[int, int, int]] = {}
    for offset, (start, job_id) in enumerate(starts):
        end = starts[offset + 1][0] if offset + 1 < len(starts) else len(lines)
        result[job_id] = (start, end, job_indent)
    return result


def _root_job_field(
    text: str,
    block: tuple[int, int, int],
    key: str,
) -> str | None:
    lines = _clean_lines(text)
    start, end, job_indent = block
    child_indexes = [
        index
        for index in range(start + 1, end)
        if lines[index].strip() and _indent(lines[index]) > job_indent
    ]
    if not child_indexes:
        return None
    child_indent = min(_indent(lines[index]) for index in child_indexes)
    pattern = re.compile(rf"^{re.escape(key)}\s*:\s*(.*)$")
    for index in child_indexes:
        line = lines[index]
        if _indent(line) != child_indent:
            continue
        match = pattern.match(line.strip())
        if match:
            return match.group(1).strip()
    return None


def required_check_errors(relative: str, text: str) -> list[str]:
    required = REQUIRED_PR_CHECKS.get(relative)
    if required is None:
        return []

    errors: list[str] = []
    if not has_unfiltered_event(text, "pull_request"):
        errors.append(
            f"{relative}: required workflow must use an unfiltered pull_request trigger"
        )

    jobs = _job_blocks(text)
    for check in required:
        block = jobs.get(check)
        if block is None:
            errors.append(f"{relative}: required check job '{check}' is missing")
            continue

        name = _root_job_field(text, block, "name")
        if name != check:
            errors.append(
                f"{relative}: required check job '{check}' must keep name '{check}'"
            )

        if _root_job_field(text, block, "if") is not None:
            errors.append(
                f"{relative}: required check job '{check}' must not use job-level if"
            )

        if _root_job_field(text, block, "needs") is not None:
            errors.append(
                f"{relative}: required check job '{check}' must not depend on another job"
            )

        if _root_job_field(text, block, "continue-on-error") is not None:
            errors.append(
                f"{relative}: required check job '{check}' must not use continue-on-error"
            )

    return errors


def repository_errors() -> list[str]:
    errors: list[str] = []
    for relative in REQUIRED_PR_CHECKS:
        path = ROOT / relative
        if not path.is_file():
            errors.append(f"{relative}: required workflow is missing")
            continue
        errors.extend(required_check_errors(relative, path.read_text(encoding="utf-8")))
    return errors


def main() -> int:
    errors = repository_errors()
    if errors:
        print("Required PR check policy failed:", file=sys.stderr)
        for error in sorted(set(errors)):
            print(f"- {error}", file=sys.stderr)
        return 1

    check_count = sum(len(checks) for checks in REQUIRED_PR_CHECKS.values())
    print(
        "Required PR check policy passed: "
        f"{check_count} required checks are unfiltered, unconditional, and dependency-independent."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
