#!/usr/bin/env python3
"""GOV-02 extension for GOV-03 review/bypass semantics and classic protection evidence.

This wrapper deliberately reuses the original GOV-02 evaluator for the core ruleset,
required-check, signature, and baseline review comparisons. It adds the policy fields
introduced by GOV-03, exact bypass-actor allowlist comparison, and supplemental classic
branch-protection evidence. It has no network access; trusted workflows provide the
GitHub API snapshot as data.
"""
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

BASE_PATH = Path(__file__).with_name("evaluate-governance-live-policy.py")
SPEC = importlib.util.spec_from_file_location("governance_live_policy_base", BASE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load base Governance live-policy evaluator")
BASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASE)

EvaluationError = BASE.EvaluationError


def _control(policy: dict[str, Any], control_id: str) -> dict[str, Any]:
    return BASE._control(policy, control_id)


def _finding(control: str, code: str, message: str) -> dict[str, str]:
    return {"control": control, "code": code, "message": message}


def _expected_ruleset_names(policy: dict[str, Any]) -> list[str]:
    expected = BASE._require_object(
        _control(policy, "GOV-RULESET-001").get("expected"),
        "GOV-RULESET-001.expected",
    )
    names = BASE._require_array(expected.get("ruleset_names"), "ruleset_names")
    if not names or not all(isinstance(item, str) and item for item in names):
        raise EvaluationError("ruleset_names must contain non-empty strings")
    return list(names)


def _active_expected_rulesets(
    snapshot: dict[str, Any], policy: dict[str, Any]
) -> list[dict[str, Any]]:
    expected = set(_expected_ruleset_names(policy))
    return [
        item
        for item in snapshot["rulesets"]
        if item["target"] == "branch"
        and item["applies_to_default_branch"]
        and item["enforcement"] == "active"
        and item["name"] in expected
    ]


def _review_params(
    snapshot: dict[str, Any], policy: dict[str, Any]
) -> list[dict[str, Any]]:
    return BASE._review_parameters(_active_expected_rulesets(snapshot, policy))


def _boolean_review_drift(
    findings: list[dict[str, str]],
    params: list[dict[str, Any]],
    expected: dict[str, Any],
) -> None:
    checks = (
        (
            "dismiss_stale_reviews_on_push",
            "dismiss_stale_reviews_on_push",
            "DISMISS_STALE_REVIEWS_DRIFT",
        ),
        (
            "require_last_push_approval",
            "require_last_push_approval",
            "LAST_PUSH_APPROVAL_DRIFT",
        ),
        (
            "required_review_thread_resolution",
            "required_review_thread_resolution",
            "REVIEW_THREAD_RESOLUTION_DRIFT",
        ),
    )
    if not params:
        return
    for policy_key, live_key, code in checks:
        expected_value = expected.get(policy_key)
        if not isinstance(expected_value, bool):
            raise EvaluationError(f"GOV-REVIEW-001.expected.{policy_key} must be boolean")
        values: list[bool] = []
        for item in params:
            if live_key not in item or not isinstance(item[live_key], bool):
                raise EvaluationError(f"pull_request.{live_key} must be observable as boolean")
            values.append(item[live_key])
        live_value = any(values)
        if live_value != expected_value:
            findings.append(
                _finding(
                    "GOV-REVIEW-001",
                    code,
                    f"{live_key} live={live_value!r} expected={expected_value!r}",
                )
            )


def _expected_bypass_entries(policy: dict[str, Any]) -> set[tuple[str, str, int, str]]:
    expected = BASE._require_object(
        _control(policy, "GOV-BYPASS-001").get("expected"),
        "GOV-BYPASS-001.expected",
    )
    actors = BASE._require_array(
        expected.get("allowed_actors"), "GOV-BYPASS-001.expected.allowed_actors"
    )
    result: set[tuple[str, str, int, str]] = set()
    for index, raw in enumerate(actors):
        actor = BASE._require_object(raw, f"allowed_actors[{index}]")
        actor_type = actor.get("actor_type")
        actor_id = actor.get("actor_id")
        bypass_mode = actor.get("bypass_mode")
        purpose = actor.get("purpose")
        rationale = actor.get("rationale")
        break_glass = actor.get("break_glass")
        normal_development = actor.get("normal_development")
        rulesets = actor.get("rulesets")
        if not isinstance(actor_type, str) or not actor_type:
            raise EvaluationError(f"allowed_actors[{index}].actor_type is invalid")
        if not isinstance(actor_id, int) or isinstance(actor_id, bool) or actor_id <= 0:
            raise EvaluationError(f"allowed_actors[{index}].actor_id is invalid")
        if bypass_mode not in {"always", "pull_request"}:
            raise EvaluationError(f"allowed_actors[{index}].bypass_mode is invalid")
        if not isinstance(purpose, str) or not purpose:
            raise EvaluationError(f"allowed_actors[{index}].purpose is required")
        if not isinstance(rationale, str) or not rationale:
            raise EvaluationError(f"allowed_actors[{index}].rationale is required")
        if not isinstance(break_glass, bool):
            raise EvaluationError(f"allowed_actors[{index}].break_glass must be boolean")
        if normal_development is not False:
            raise EvaluationError(f"allowed_actors[{index}].normal_development must be false")
        ruleset_names = BASE._require_array(rulesets, f"allowed_actors[{index}].rulesets")
        if not ruleset_names or not all(isinstance(name, str) and name for name in ruleset_names):
            raise EvaluationError(f"allowed_actors[{index}].rulesets must be non-empty strings")
        if actor_type == "User" and expected.get("user_always_bypass") == "forbidden" and bypass_mode == "always":
            raise EvaluationError("policy cannot allow a User/always actor while user_always_bypass is forbidden")
        for ruleset in ruleset_names:
            result.add((ruleset, actor_type, actor_id, bypass_mode))
    return result


def _observed_bypass_entries(
    snapshot: dict[str, Any], policy: dict[str, Any]
) -> set[tuple[str, str, int, str]]:
    result: set[tuple[str, str, int, str]] = set()
    for item in _active_expected_rulesets(snapshot, policy):
        if not item.get("bypass_actors_observable"):
            continue
        for actor in item.get("bypass_actors", []):
            actor_id = actor.get("actor_id")
            if not isinstance(actor_id, int) or isinstance(actor_id, bool):
                raise EvaluationError("observed bypass actor_id must be an integer")
            result.add(
                (
                    item["name"],
                    str(actor.get("actor_type")),
                    actor_id,
                    str(actor.get("bypass_mode")),
                )
            )
    return result


def _apply_bypass_policy(
    findings: list[dict[str, str]],
    snapshot: dict[str, Any],
    policy: dict[str, Any],
) -> None:
    expected_control = BASE._require_object(
        _control(policy, "GOV-BYPASS-001").get("expected"),
        "GOV-BYPASS-001.expected",
    )
    expected = _expected_bypass_entries(policy)
    observed = _observed_bypass_entries(snapshot, policy)

    for entry in sorted(observed - expected):
        ruleset, actor_type, actor_id, bypass_mode = entry
        findings.append(
            _finding(
                "GOV-BYPASS-001",
                "UNEXPECTED_BYPASS_ACTOR",
                f"unexpected bypass actor ruleset={ruleset!r} type={actor_type!r} id={actor_id!r} mode={bypass_mode!r}",
            )
        )
    for entry in sorted(expected - observed):
        ruleset, actor_type, actor_id, bypass_mode = entry
        findings.append(
            _finding(
                "GOV-BYPASS-001",
                "EXPECTED_BYPASS_ACTOR_MISSING",
                f"expected bypass actor is absent ruleset={ruleset!r} type={actor_type!r} id={actor_id!r} mode={bypass_mode!r}",
            )
        )

    if expected_control.get("user_always_bypass") == "forbidden":
        for ruleset, actor_type, actor_id, bypass_mode in sorted(observed):
            if actor_type == "User" and bypass_mode == "always":
                findings.append(
                    _finding(
                        "GOV-BYPASS-001",
                        "USER_ALWAYS_BYPASS_FORBIDDEN",
                        f"User/always bypass remains active on {ruleset!r} for actor {actor_id}",
                    )
                )


def _classic_projection(live_state: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, str]]]:
    observations: list[dict[str, str]] = []
    raw = live_state.get("classic_branch_protection")
    if raw is None:
        projection = {
            "observable": False,
            "configured": None,
            "http_status": None,
            "error_class": "not-recorded",
            "details": None,
        }
        observations.append(
            {
                "code": "CLASSIC_BRANCH_PROTECTION_NOT_RECORDED",
                "message": "classic branch-protection detail was not included in the live snapshot",
            }
        )
        return projection, observations
    classic = BASE._require_object(raw, "live.classic_branch_protection")
    observable = classic.get("observable")
    configured = classic.get("configured")
    if not isinstance(observable, bool):
        raise EvaluationError("classic_branch_protection.observable must be boolean")
    if configured is not None and not isinstance(configured, bool):
        raise EvaluationError("classic_branch_protection.configured must be boolean or null")
    http_status = classic.get("http_status")
    if http_status is not None and (not isinstance(http_status, int) or isinstance(http_status, bool)):
        raise EvaluationError("classic_branch_protection.http_status must be integer or null")
    error_class = classic.get("error_class")
    if error_class is not None and not isinstance(error_class, str):
        raise EvaluationError("classic_branch_protection.error_class must be string or null")
    details = classic.get("details")
    if details is not None and not isinstance(details, dict):
        raise EvaluationError("classic_branch_protection.details must be object or null")
    projection = {
        "observable": observable,
        "configured": configured,
        "http_status": http_status,
        "error_class": error_class,
        "details": BASE._canonicalize(details) if details is not None else None,
    }
    if not observable:
        observations.append(
            {
                "code": "CLASSIC_BRANCH_PROTECTION_UNOBSERVABLE",
                "message": f"classic branch-protection detail endpoint was not observable ({error_class or 'unknown'})",
            }
        )
    elif configured:
        observations.append(
            {
                "code": "CLASSIC_BRANCH_PROTECTION_PRESENT",
                "message": "classic branch protection is configured in addition to repository rulesets",
            }
        )
    return projection, observations


def _recompute(report: dict[str, Any]) -> None:
    findings = report["findings"]
    for control in report.get("controls", []):
        cid = control.get("id")
        codes = sorted({item["code"] for item in findings if item.get("control") == cid})
        control["status"] = "FAIL" if codes else "PASS"
        control["finding_codes"] = codes
    report["status"] = "FAIL" if findings else "PASS"
    report["snapshot_sha256"] = BASE._sha256_json(report["snapshot"])


def evaluate_policy(
    policy: dict[str, Any], live_state: dict[str, Any], target_sha: str | None = None
) -> dict[str, Any]:
    original_policy = copy.deepcopy(policy)
    base_policy = copy.deepcopy(policy)

    # The original GOV-02 implementation only accepted an empty bypass allowlist.
    # Neutralize that one legacy restriction for the base pass, then apply GOV-03's
    # complete actor schema and exact set comparison below.
    bypass_control = _control(base_policy, "GOV-BYPASS-001")
    bypass_expected = BASE._require_object(
        bypass_control.get("expected"), "GOV-BYPASS-001.expected"
    )
    original_allowed = copy.deepcopy(bypass_expected.get("allowed_actors", []))
    bypass_expected["allowed_actors"] = []

    report = BASE.evaluate_policy(base_policy, live_state, target_sha)
    report["findings"] = [
        item
        for item in report["findings"]
        if not (
            item.get("control") == "GOV-BYPASS-001"
            and item.get("code") == "UNEXPECTED_BYPASS_ACTOR"
        )
    ]

    # Restore/validate the original policy actor list before exact comparison.
    original_bypass = _control(original_policy, "GOV-BYPASS-001")
    original_expected = BASE._require_object(
        original_bypass.get("expected"), "GOV-BYPASS-001.expected"
    )
    original_expected["allowed_actors"] = original_allowed

    review_expected = BASE._require_object(
        _control(original_policy, "GOV-REVIEW-001").get("expected"),
        "GOV-REVIEW-001.expected",
    )
    _boolean_review_drift(
        report["findings"],
        _review_params(report["snapshot"], original_policy),
        review_expected,
    )
    _apply_bypass_policy(report["findings"], report["snapshot"], original_policy)

    classic, observations = _classic_projection(live_state)
    report["snapshot"]["classic_branch_protection"] = classic
    branch = BASE._require_object(live_state.get("branch"), "live.branch")
    report["snapshot"]["branch"]["classic_summary"] = BASE._canonicalize(
        branch.get("protection", {})
    )
    report["observations"] = observations
    report["evaluator_extension"] = "gov03-review-bypass-classic-v1"
    _recompute(report)
    return report


def _invalid_report(exc: Exception, target_sha: str | None) -> dict[str, Any]:
    report = BASE._invalid_report(exc, target_sha)
    report["observations"] = []
    report["evaluator_extension"] = "gov03-review-bypass-classic-v1"
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--policy", required=True, type=Path)
    parser.add_argument("--live-state", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--target-sha")
    args = parser.parse_args(argv)
    try:
        policy = BASE._require_object(
            json.loads(args.policy.read_text(encoding="utf-8")), "policy"
        )
        live_state = BASE._require_object(
            json.loads(args.live_state.read_text(encoding="utf-8")), "live state"
        )
        report = evaluate_policy(policy, live_state, args.target_sha)
    except (
        OSError,
        json.JSONDecodeError,
        EvaluationError,
        KeyError,
        TypeError,
        ValueError,
    ) as exc:
        report = _invalid_report(exc, args.target_sha)
        BASE._write_report(args.output, report)
        return 2
    BASE._write_report(args.output, report)
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
