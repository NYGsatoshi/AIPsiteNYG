#!/usr/bin/env python3
"""Validate GOV-03 CODEOWNERS, review, bypass, and trusted status invariants."""
from __future__ import annotations

import fnmatch
import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[2]
REVIEW_CONTROL_ID = "GOV-REVIEW-001"
BYPASS_CONTROL_ID = "GOV-BYPASS-001"
CHECKS_CONTROL_ID = "GOV-CHECKS-001"


def _load_policy(root: Path) -> dict[str, Any]:
    value = json.loads((root / "governance/policy.json").read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("governance policy root must be an object")
    return value


def _control(policy: dict[str, Any], control_id: str) -> dict[str, Any]:
    controls = policy.get("controls")
    matches = [item for item in controls if isinstance(item, dict) and item.get("id") == control_id] if isinstance(controls, list) else []
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
        prefix = normalized[:-3].rstrip("/")
        return relative == prefix or relative.startswith(prefix + "/")
    if normalized.endswith("/"):
        prefix = normalized.rstrip("/")
        return relative == prefix or relative.startswith(prefix + "/")
    if "/" not in normalized:
        return fnmatch.fnmatchcase(Path(relative).name, normalized)
    return fnmatch.fnmatchcase(relative, normalized)


def parse_codeowners(text: str) -> tuple[list[tuple[str, tuple[str, ...]]], list[str]]:
    rules: list[tuple[str, tuple[str, ...]]] = []
    errors: list[str] = []
    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        parts = line.split()
        pattern = parts[0]
        owners = tuple(dict.fromkeys(parts[1:]))
        if pattern.startswith("!"):
            errors.append(f"CODEOWNERS:{number}: negation patterns are not supported")
        if "[" in pattern or "]" in pattern:
            errors.append(f"CODEOWNERS:{number}: bracket character classes are not supported")
        if len(parts) < 2:
            errors.append(f"CODEOWNERS:{number}: pattern {pattern!r} has no owner")
        invalid = [owner for owner in owners if not re.fullmatch(r"@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:/[A-Za-z0-9_.-]+)?", owner)]
        if invalid:
            errors.append(f"CODEOWNERS:{number}: invalid owner token(s): {', '.join(invalid)}")
        if not invalid and not pattern.startswith("!") and "[" not in pattern and "]" not in pattern:
            rules.append((pattern, owners))
    if not rules:
        errors.append("CODEOWNERS: no valid ownership rules found")
    return rules, errors


def effective_codeowners(rules_or_text: Iterable[tuple[str, tuple[str, ...]]] | str, relative: str) -> tuple[str, ...]:
    rules = parse_codeowners(rules_or_text)[0] if isinstance(rules_or_text, str) else list(rules_or_text)
    owners: tuple[str, ...] = ()
    for pattern, candidate in rules:
        if _codeowners_match(pattern, relative):
            owners = candidate
    return owners


def _review_contract_errors(policy: dict[str, Any]) -> list[str]:
    expected = _control(policy, REVIEW_CONTROL_ID).get("expected")
    if not isinstance(expected, dict):
        return [f"{REVIEW_CONTROL_ID}: expected must be an object"]
    errors: list[str] = []
    required_true = (
        "pull_request_required", "required_review_thread_resolution",
        "author_cannot_self_approve", "external_pr_current_head_approval_required",
        "external_approval_reviewer_must_be_codeowner", "draft_pr_blocks",
        "changes_requested_blocks", "codeowners_fallback_required",
    )
    for name in required_true:
        if expected.get(name) is not True:
            errors.append(f"{REVIEW_CONTROL_ID}: {name} must be true")
    if expected.get("previous_head_approval_satisfies") is not False:
        errors.append(f"{REVIEW_CONTROL_ID}: previous-head approval must never satisfy policy")
    reviewer = expected.get("external_pr_approval_reviewer")
    if not isinstance(reviewer, str) or not re.fullmatch(r"@[A-Za-z0-9-]+", reviewer):
        errors.append(f"{REVIEW_CONTROL_ID}: external_pr_approval_reviewer is invalid")
    minimum = expected.get("minimum_distinct_codeowners")
    if not isinstance(minimum, int) or isinstance(minimum, bool) or minimum < 1:
        errors.append(f"{REVIEW_CONTROL_ID}: minimum_distinct_codeowners must be at least 1")
    approvals = expected.get("approvals_required")
    if not isinstance(approvals, int) or isinstance(approvals, bool) or approvals < 0:
        errors.append(f"{REVIEW_CONTROL_ID}: approvals_required must be a non-negative integer")
    if minimum == 1 and expected.get("owner_authored_pr_external_approval_required") is False:
        if approvals != 0 or expected.get("codeowners_review_required") is not False:
            errors.append(
                f"{REVIEW_CONTROL_ID}: single-owner topology must not require native approval/CODEOWNER review; "
                "the trusted evaluator owns external current-head approval"
            )
        if expected.get("unattributed_changes_require_additional_approval") is not False:
            errors.append(f"{REVIEW_CONTROL_ID}: single-owner topology must not add a native unattributed-change approval")
    if expected.get("dismiss_stale_reviews_on_push") is False and expected.get("require_last_push_approval") is False:
        if expected.get("external_pr_current_head_approval_required") is not True:
            errors.append(f"{REVIEW_CONTROL_ID}: stale-review native guards may both be false only with current-head trusted evaluation")
    return errors


def _codeowners_contract_errors(policy: dict[str, Any], root: Path) -> list[str]:
    expected = _control(policy, REVIEW_CONTROL_ID).get("expected")
    if not isinstance(expected, dict):
        return []
    path = root / ".github/CODEOWNERS"
    if not path.is_file():
        return [f"{REVIEW_CONTROL_ID}: .github/CODEOWNERS is missing"]
    rules, errors = parse_codeowners(path.read_text(encoding="utf-8"))
    findings = [f"{REVIEW_CONTROL_ID}: {error}" for error in errors]
    minimum = expected.get("minimum_distinct_codeowners", 1)
    reviewer = expected.get("external_pr_approval_reviewer")

    if expected.get("codeowners_fallback_required") is True:
        fallback = [owners for pattern, owners in rules if pattern == "*"]
        if not fallback or not fallback[-1]:
            findings.append(f"{REVIEW_CONTROL_ID}: explicit '*' fallback ownership is required")

    required_patterns = expected.get("codeowners_required_explicit_patterns")
    if isinstance(required_patterns, list):
        by_pattern = {pattern: owners for pattern, owners in rules}
        for pattern in required_patterns:
            owners = by_pattern.get(pattern, ())
            if not owners:
                findings.append(f"{REVIEW_CONTROL_ID}: required explicit CODEOWNERS pattern {pattern!r} is missing or ownerless")

    sensitive = expected.get("codeowners_sensitive_paths")
    if isinstance(sensitive, list):
        for relative in sensitive:
            owners = effective_codeowners(rules, relative)
            if len(owners) < minimum:
                findings.append(
                    f"{REVIEW_CONTROL_ID}: sensitive path {relative!r} has {len(owners)} effective CODEOWNER(s); "
                    f"policy requires at least {minimum}"
                )
            if expected.get("external_approval_reviewer_must_be_codeowner") is True and isinstance(reviewer, str) and reviewer not in owners:
                findings.append(f"{REVIEW_CONTROL_ID}: external reviewer {reviewer} is not an effective CODEOWNER for {relative!r}")
    return findings


def review_ruleset_drift_errors(policy: dict[str, Any], live_ruleset: dict[str, Any]) -> list[str]:
    expected = _control(policy, REVIEW_CONTROL_ID)["expected"]
    pull_rules = [rule for rule in live_ruleset.get("rules", []) if isinstance(rule, dict) and rule.get("type") == "pull_request"]
    if len(pull_rules) != 1:
        return [f"{REVIEW_CONTROL_ID}: ruleset {live_ruleset.get('name')!r} must contain exactly one pull_request rule"]
    params = pull_rules[0].get("parameters")
    if not isinstance(params, dict):
        return [f"{REVIEW_CONTROL_ID}: pull_request rule parameters are missing"]
    mapping = {
        "required_approving_review_count": "approvals_required",
        "dismiss_stale_reviews_on_push": "dismiss_stale_reviews_on_push",
        "require_code_owner_review": "codeowners_review_required",
        "require_last_push_approval": "require_last_push_approval",
        "required_review_thread_resolution": "required_review_thread_resolution",
        "require_extra_approval_for_unattributed_changes": "unattributed_changes_require_additional_approval",
    }
    errors: list[str] = []
    for live_key, expected_key in mapping.items():
        if params.get(live_key) != expected.get(expected_key):
            errors.append(
                f"{REVIEW_CONTROL_ID}: {live_ruleset.get('name')!r} {live_key}={params.get(live_key)!r}; "
                f"expected {expected.get(expected_key)!r}"
            )
    return errors


def _bypass_contract_errors(policy: dict[str, Any]) -> list[str]:
    expected = _control(policy, BYPASS_CONTROL_ID).get("expected")
    if not isinstance(expected, dict):
        return [f"{BYPASS_CONTROL_ID}: expected must be an object"]
    errors: list[str] = []
    if expected.get("normal_development_bypass_forbidden") is not True:
        errors.append(f"{BYPASS_CONTROL_ID}: normal development bypass must be forbidden")
    if expected.get("break_glass_usage_evidence_required") is not True:
        errors.append(f"{BYPASS_CONTROL_ID}: break-glass use must be exposed in evidence")
    actors = expected.get("allowed_actors")
    if not isinstance(actors, list):
        return errors + [f"{BYPASS_CONTROL_ID}: allowed_actors must be an array"]
    seen: set[tuple[str, int, str, str]] = set()
    for index, actor in enumerate(actors):
        if not isinstance(actor, dict):
            errors.append(f"{BYPASS_CONTROL_ID}: allowed_actors[{index}] must be an object")
            continue
        key = (str(actor.get("actor_type")), int(actor.get("actor_id", -1)), str(actor.get("bypass_mode")), json.dumps(actor.get("rulesets"), sort_keys=True))
        if key in seen:
            errors.append(f"{BYPASS_CONTROL_ID}: duplicate bypass actor {key[:3]}")
        seen.add(key)
        for field in ("purpose", "rationale"):
            if not isinstance(actor.get(field), str) or not actor[field].strip():
                errors.append(f"{BYPASS_CONTROL_ID}: allowed_actors[{index}].{field} is required")
        if actor.get("normal_development") is not False:
            errors.append(f"{BYPASS_CONTROL_ID}: allowed_actors[{index}] cannot be a normal development path")
        if actor.get("actor_type") == "User" and actor.get("bypass_mode") == "always":
            if expected.get("user_always_bypass") == "forbidden":
                errors.append(f"{BYPASS_CONTROL_ID}: user-level always bypass is forbidden")
            elif actor.get("break_glass") is not True:
                errors.append(f"{BYPASS_CONTROL_ID}: user-level always bypass must be break-glass")
    return errors


def bypass_drift_errors(policy: dict[str, Any], live_rulesets: list[dict[str, Any]]) -> list[str]:
    """Reject live bypass expansion; missing allowlisted actors are policy tightening and allowed."""
    expected = _control(policy, BYPASS_CONTROL_ID)["expected"]
    allowed = expected.get("allowed_actors", [])
    errors: list[str] = []
    for ruleset in live_rulesets:
        name = ruleset.get("name")
        for actor in ruleset.get("bypass_actors", []):
            if not isinstance(actor, dict):
                errors.append(f"{BYPASS_CONTROL_ID}: malformed bypass actor in ruleset {name!r}")
                continue
            match = next((entry for entry in allowed if isinstance(entry, dict)
                          and entry.get("actor_type") == actor.get("actor_type")
                          and entry.get("actor_id") == actor.get("actor_id")
                          and entry.get("bypass_mode") == actor.get("bypass_mode")
                          and name in entry.get("rulesets", [])), None)
            if match is None:
                errors.append(
                    f"{BYPASS_CONTROL_ID}: unexpected bypass actor in {name!r}: "
                    f"{actor.get('actor_type')}:{actor.get('actor_id')} mode={actor.get('bypass_mode')}"
                )
    return errors


def _workflow_job_ids(text: str) -> set[str]:
    lines = text.splitlines()
    jobs_index = next((index for index, line in enumerate(lines) if re.match(r"^jobs\s*:\s*$", line)), None)
    if jobs_index is None:
        return set()
    base_indent = len(lines[jobs_index]) - len(lines[jobs_index].lstrip())
    candidates = [index for index in range(jobs_index + 1, len(lines)) if lines[index].strip() and len(lines[index]) - len(lines[index].lstrip()) > base_indent]
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
    status_producers = [item for item in required if isinstance(item, dict) and item.get("kind") == "commit-status"]
    if len(status_producers) != 1:
        errors.append(f"{CHECKS_CONTROL_ID}: exactly one trusted commit-status producer is required; found {len(status_producers)}")
    for item in required:
        if not isinstance(item, dict):
            continue
        kind, workflow, job, context = item.get("kind"), item.get("workflow"), item.get("job"), item.get("context")
        if kind == "workflow-job" and context != job:
            errors.append(f"{CHECKS_CONTROL_ID}: workflow-job context {context!r} must equal job {job!r}")
        if not all(isinstance(value, str) and value for value in (workflow, job, context)):
            continue
        workflow_path = root / workflow
        if not workflow_path.is_file():
            continue
        text = workflow_path.read_text(encoding="utf-8")
        if job not in _workflow_job_ids(text):
            errors.append(f"{CHECKS_CONTROL_ID}: producer job {job!r} does not exist in {workflow}")
        if kind != "commit-status":
            continue
        if context in text:
            errors.append(f"{CHECKS_CONTROL_ID}: commit-status context {context!r} is hard-coded in {workflow}; resolve it from governance/policy.json instead")
        for fragment in ("governance/policy.json", "GOV-CHECKS-001", "required-status-checks", "commit-status", "status_context", "GOV-REVIEW-001", "external_pr_approval_reviewer", "default_branch", "evaluate-governance-pr-review.py"):
            if fragment not in text:
                errors.append(f"{CHECKS_CONTROL_ID}: trusted status producer {workflow!r} does not prove canonical policy/evaluator lookup ({fragment!r} missing)")
    return errors


def repository_errors(root: Path = ROOT) -> list[str]:
    try:
        policy = _load_policy(root)
        return (_review_contract_errors(policy) + _codeowners_contract_errors(policy, root)
                + _bypass_contract_errors(policy) + _status_contract_errors(policy, root))
    except (OSError, json.JSONDecodeError, ValueError, KeyError, TypeError) as exc:
        return [f"governance review invariant validation failed to load contract: {exc}"]


def main() -> int:
    errors = sorted(set(repository_errors()))
    if errors:
        print("Governance review/CODEOWNERS/bypass invariant validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("Governance review/CODEOWNERS/bypass invariant validation passed: sensitive ownership, single-maintainer review responsibilities, bypass allowlist, and policy-derived trusted status producer verified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
