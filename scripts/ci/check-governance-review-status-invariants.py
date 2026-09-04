#!/usr/bin/env python3
"""Validate GOV-01 review contract and trusted status-producer invariants."""

from __future__ import annotations

import fnmatch
import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
REVIEW_CONTROL_ID = "GOV-REVIEW-001"
CHECKS_CONTROL_ID = "GOV-CHECKS-001"
CRITICAL_GOVERNANCE_PATHS = (
    ".github/CODEOWNERS",
    ".github/workflows/ci.yml",
    ".github/workflows/publication-readiness.yml",
    ".github/workflows/external-pr-approval-evaluator.yml",
    "scripts/ci/check-required-pr-checks.py",
    "scripts/ci/check-governance-review-status-invariants.py",
    "governance/policy.json",
    "governance/policy.schema.json",
)


def _load_policy(root: Path) -> dict[str, Any]:
    value = json.loads((root / "governance/policy.json").read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("governance policy root must be an object")
    return value


def _control(policy: dict[str, Any], control_id: str) -> dict[str, Any]:
    controls = policy.get("controls")
    matches = [
        item for item in controls if isinstance(item, dict) and item.get("id") == control_id
    ] if isinstance(controls, list) else []
    if len(matches) != 1:
        raise ValueError(f"policy must define exactly one {control_id} control")
    return matches[0]


def _codeowners_match(pattern: str, relative: str) -> bool:
    normalized = pattern.strip().lstrip("/")
    if not normalized or normalized.startswith("!"):
        return False
    if normalized == "*":
        return True
    if normalized.endswith("/**"):
        return relative.startswith(normalized[:-3])
    if normalized.endswith("/"):
        return relative.startswith(normalized)
    if "/" not in normalized:
        return fnmatch.fnmatchcase(Path(relative).name, normalized)
    return fnmatch.fnmatchcase(relative, normalized)


def effective_codeowners(text: str, relative: str) -> tuple[str, ...]:
    """Return owners from the last matching CODEOWNERS rule."""
    owners: tuple[str, ...] = ()
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        if _codeowners_match(parts[0], relative):
            owners = tuple(
                dict.fromkeys(item for item in parts[1:] if item.startswith("@"))
            )
    return owners


def _workflow_job_ids(text: str) -> set[str]:
    lines = text.splitlines()
    jobs_index = next(
        (index for index, line in enumerate(lines) if re.match(r"^jobs\s*:\s*$", line)),
        None,
    )
    if jobs_index is None:
        return set()
    base_indent = len(lines[jobs_index]) - len(lines[jobs_index].lstrip())
    candidates = [
        index
        for index in range(jobs_index + 1, len(lines))
        if lines[index].strip()
        and len(lines[index]) - len(lines[index].lstrip()) > base_indent
    ]
    if not candidates:
        return set()
    job_indent = min(len(lines[index]) - len(lines[index].lstrip()) for index in candidates)
    jobs: set[str] = set()
    for index in candidates:
        line = lines[index]
        if len(line) - len(line.lstrip()) != job_indent:
            continue
        match = re.match(r"^([A-Za-z0-9_.-]+)\s*:\s*$", line.strip())
        if match:
            jobs.add(match.group(1))
    return jobs


def _review_contract_errors(policy: dict[str, Any]) -> list[str]:
    """Validate the expected review contract, not current repository provisioning.

    GOV-01 owns the versioned expectation. Whether live/effective CODEOWNERS and
    GitHub review settings satisfy that expectation is GOV-03's reconciliation
    responsibility. Keeping the two phases separate prevents a repository setup
    prerequisite from making the GOV-01 policy-definition gate impossible to land.
    """
    control = _control(policy, REVIEW_CONTROL_ID)
    expected = control.get("expected")
    if not isinstance(expected, dict):
        return [f"{REVIEW_CONTROL_ID}: expected must be an object"]

    errors: list[str] = []
    if expected.get("independent_approval_required") is not True:
        errors.append(f"{REVIEW_CONTROL_ID}: independent approval must be required")
    if expected.get("author_cannot_self_approve") is not True:
        errors.append(f"{REVIEW_CONTROL_ID}: author self-approval must be forbidden")
    minimum = expected.get("minimum_distinct_codeowners")
    if not isinstance(minimum, int) or isinstance(minimum, bool) or minimum < 2:
        errors.append(f"{REVIEW_CONTROL_ID}: minimum_distinct_codeowners must be at least 2")
    reviewer = expected.get("external_pr_approval_reviewer")
    if not isinstance(reviewer, str) or not re.fullmatch(r"@[A-Za-z0-9-]+", reviewer):
        errors.append(f"{REVIEW_CONTROL_ID}: external_pr_approval_reviewer is invalid")
    return errors


def review_topology_findings(policy: dict[str, Any], root: Path) -> list[str]:
    """Report current CODEOWNERS topology without making GOV-01 fail.

    These findings are deliberately advisory in GOV-01. GOV-03 owns blocking
    CODEOWNERS/review/live-ruleset reconciliation. The policy expectation remains
    blocking and cannot be silently downgraded.
    """
    control = _control(policy, REVIEW_CONTROL_ID)
    expected = control.get("expected")
    minimum = expected.get("minimum_distinct_codeowners") if isinstance(expected, dict) else None
    if not isinstance(minimum, int) or isinstance(minimum, bool) or minimum < 2:
        return []

    path = root / ".github/CODEOWNERS"
    if not path.is_file():
        # Existence is already a blocking policy-reference invariant in
        # validate-governance-policy.py, so avoid duplicating that failure here.
        return []

    text = path.read_text(encoding="utf-8")
    findings: list[str] = []
    for relative in CRITICAL_GOVERNANCE_PATHS:
        owners = effective_codeowners(text, relative)
        if len(owners) < minimum:
            findings.append(
                f"{REVIEW_CONTROL_ID}: {relative!r} has {len(owners)} effective "
                f"CODEOWNER(s); policy expects at least {minimum}. GOV-03 must "
                "reconcile this before claiming review-policy compliance"
            )
    return findings


def _status_contract_errors(policy: dict[str, Any], root: Path) -> list[str]:
    control = _control(policy, CHECKS_CONTROL_ID)
    expected = control.get("expected")
    references = control.get("references")
    required = expected.get("required") if isinstance(expected, dict) else None
    reference_checks = references.get("checks") if isinstance(references, dict) else None
    if not isinstance(required, list) or not required:
        return [f"{CHECKS_CONTROL_ID}: expected.required must be non-empty"]

    errors: list[str] = []
    if required != reference_checks:
        errors.append(f"{CHECKS_CONTROL_ID}: expected.required and references.checks must be identical")
    contexts = [item.get("context") for item in required if isinstance(item, dict)]
    if len(contexts) != len(required) or len(contexts) != len(set(contexts)):
        errors.append(f"{CHECKS_CONTROL_ID}: required status contexts must be complete and unique")

    status_producers = [
        item for item in required
        if isinstance(item, dict) and item.get("kind") == "commit-status"
    ]
    if len(status_producers) != 1:
        errors.append(
            f"{CHECKS_CONTROL_ID}: exactly one trusted commit-status producer is required; "
            f"found {len(status_producers)}"
        )

    for item in required:
        if not isinstance(item, dict):
            continue
        kind = item.get("kind")
        workflow = item.get("workflow")
        job = item.get("job")
        context = item.get("context")
        if kind == "workflow-job" and context != job:
            errors.append(
                f"{CHECKS_CONTROL_ID}: workflow-job context {context!r} must equal job {job!r}"
            )
        if not all(isinstance(value, str) and value for value in (workflow, job, context)):
            continue
        workflow_path = root / workflow
        if not workflow_path.is_file():
            continue
        text = workflow_path.read_text(encoding="utf-8")
        if job not in _workflow_job_ids(text):
            errors.append(
                f"{CHECKS_CONTROL_ID}: producer job {job!r} does not exist in {workflow}"
            )
        if kind != "commit-status":
            continue
        if context in text:
            errors.append(
                f"{CHECKS_CONTROL_ID}: commit-status context {context!r} is hard-coded in "
                f"{workflow}; resolve it from governance/policy.json instead"
            )
        for fragment in (
            "governance/policy.json",
            "GOV-CHECKS-001",
            "required-status-checks",
            "commit-status",
            "status_context",
            "GOV-REVIEW-001",
            "external_pr_approval_reviewer",
            "default_branch",
        ):
            if fragment not in text:
                errors.append(
                    f"{CHECKS_CONTROL_ID}: trusted status producer {workflow!r} does not "
                    f"prove canonical policy lookup ({fragment!r} missing)"
                )
    return errors


def repository_errors(root: Path = ROOT) -> list[str]:
    try:
        policy = _load_policy(root)
        return _review_contract_errors(policy) + _status_contract_errors(policy, root)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        return [f"governance invariant validation failed to load contract: {exc}"]


def repository_findings(root: Path = ROOT) -> list[str]:
    try:
        policy = _load_policy(root)
        return review_topology_findings(policy, root)
    except (OSError, json.JSONDecodeError, ValueError):
        return []


def main() -> int:
    errors = sorted(set(repository_errors()))
    if errors:
        print("Governance review/status invariant validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    findings = sorted(set(repository_findings()))
    for finding in findings:
        print(f"::warning title=GOV-03 review topology::{finding}")

    print(
        "Governance review/status invariant validation passed: GOV-01 review contract "
        "and policy-derived trusted status producer verified. Effective CODEOWNERS "
        "reconciliation is reported for GOV-03 and is not a GOV-01 static-gate failure."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
