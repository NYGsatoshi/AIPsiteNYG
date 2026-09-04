#!/usr/bin/env python3
from __future__ import annotations

import copy
import datetime as dt
import importlib.util
import unittest
from pathlib import Path
from typing import Any

MODULE_PATH = Path(__file__).with_name("check-required-pr-checks.py")
SPEC = importlib.util.spec_from_file_location("required_check_guard", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load required PR check guard")
guard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)

REGISTRY = guard.load_required_check_registry()
HEAD = "a" * 40
OLD_HEAD = "b" * 40
NOW = dt.datetime(2026, 9, 4, 5, 30, tzinfo=dt.timezone.utc)


class RequiredPrCheckPolicyTests(unittest.TestCase):
    def ci_errors(self, text: str) -> list[str]:
        return guard.required_check_errors(".github/workflows/ci.yml", text, REGISTRY)

    def publication_errors(self, text: str) -> list[str]:
        return guard.required_check_errors(
            ".github/workflows/publication-readiness.yml", text, REGISTRY
        )

    def evaluator_errors(self, text: str) -> list[str]:
        return guard.required_check_errors(
            ".github/workflows/external-pr-approval-evaluator.yml", text, REGISTRY
        )

    def test_registry_matches_governance_policy(self) -> None:
        self.assertEqual(5, len(REGISTRY["checks"]))
        self.assertEqual(
            [
                "External PR approval policy",
                "build-test",
                "frontend-test",
                "security-scan",
                "publication-readiness",
            ],
            [item["context"] for item in REGISTRY["checks"]],
        )
        self.assertEqual(
            15368,
            next(item for item in REGISTRY["checks"] if item["context"] == "build-test")[
                "ruleset_integration_id"
            ],
        )

    def test_unfiltered_required_jobs_are_accepted(self) -> None:
        text = """
name: CI
on:
  pull_request:
jobs:
  build-test:
    name: build-test
    runs-on: ubuntu-latest
    timeout-minutes: 120
  frontend-test:
    name: frontend-test
    runs-on: ubuntu-latest
    timeout-minutes: 120
  security-scan:
    name: security-scan
    runs-on: ubuntu-latest
    timeout-minutes: 90
"""
        self.assertEqual([], self.ci_errors(text))

    def test_pull_request_paths_filter_is_rejected(self) -> None:
        text = """
name: Publication Readiness
on:
  pull_request:
    paths:
      - "src/**"
jobs:
  publication-readiness:
    name: publication-readiness
    runs-on: ubuntu-latest
    timeout-minutes: 20
"""
        errors = self.publication_errors(text)
        self.assertTrue(any("unfiltered pull_request" in error for error in errors))

    def test_required_job_if_is_rejected(self) -> None:
        text = """
on:
  pull_request:
jobs:
  publication-readiness:
    name: publication-readiness
    if: github.actor != 'example'
    runs-on: ubuntu-latest
    timeout-minutes: 20
"""
        self.assertTrue(
            any("job-level if" in error for error in self.publication_errors(text))
        )

    def test_required_job_dependency_is_rejected(self) -> None:
        text = """
on:
  pull_request:
jobs:
  prepare:
    name: prepare
    runs-on: ubuntu-latest
  publication-readiness:
    name: publication-readiness
    needs: prepare
    runs-on: ubuntu-latest
    timeout-minutes: 20
"""
        self.assertTrue(
            any("must not depend" in error for error in self.publication_errors(text))
        )

    def test_required_job_continue_on_error_is_rejected(self) -> None:
        text = """
on:
  pull_request:
jobs:
  publication-readiness:
    name: publication-readiness
    continue-on-error: true
    runs-on: ubuntu-latest
    timeout-minutes: 20
"""
        self.assertTrue(
            any("continue-on-error" in error for error in self.publication_errors(text))
        )

    def test_required_job_name_change_is_rejected(self) -> None:
        text = """
on:
  pull_request:
jobs:
  publication-readiness:
    name: renamed-check
    runs-on: ubuntu-latest
    timeout-minutes: 20
"""
        self.assertTrue(
            any("must keep name" in error for error in self.publication_errors(text))
        )

    def test_required_job_timeout_drift_is_rejected(self) -> None:
        text = """
on:
  pull_request:
jobs:
  publication-readiness:
    name: publication-readiness
    runs-on: ubuntu-latest
    timeout-minutes: 999
"""
        self.assertTrue(
            any("timeout-minutes" in error for error in self.publication_errors(text))
        )

    def test_missing_required_job_is_rejected(self) -> None:
        text = """
on:
  pull_request:
jobs:
  publication-readiness:
    name: publication-readiness
    runs-on: ubuntu-latest
    timeout-minutes: 20
"""
        errors = self.ci_errors(text)
        self.assertTrue(
            any("required check job 'build-test' is missing" in error for error in errors)
        )

    def test_trusted_status_source_drift_is_rejected(self) -> None:
        text = """
on:
  workflow_run:
    workflows: ["Wrong signal"]
    types: [completed]
jobs:
  evaluate:
    name: External PR approval evaluator
    runs-on: ubuntu-latest
    timeout-minutes: 5
"""
        errors = self.evaluator_errors(text)
        self.assertTrue(any("trusted commit-status producer" in error for error in errors))


class LiveRulesetTests(unittest.TestCase):
    def live_ruleset(self) -> dict[str, Any]:
        checks = []
        for item in REGISTRY["checks"]:
            value: dict[str, Any] = {"context": item["context"]}
            if item["ruleset_integration_id"] is not None:
                value["integration_id"] = item["ruleset_integration_id"]
            checks.append(value)
        return {
            "name": REGISTRY["ruleset"]["name"],
            "target": "branch",
            "enforcement": "active",
            "conditions": {"ref_name": {"exclude": [], "include": ["~DEFAULT_BRANCH"]}},
            "rules": [
                {
                    "type": "required_status_checks",
                    "parameters": {
                        "strict_required_status_checks_policy": True,
                        "required_status_checks": checks,
                    },
                }
            ],
        }

    def test_exact_live_ruleset_passes(self) -> None:
        self.assertEqual([], guard.live_ruleset_errors(REGISTRY, self.live_ruleset()))

    def test_old_ruleset_context_drift_fails(self) -> None:
        live = self.live_ruleset()
        live["rules"][0]["parameters"]["required_status_checks"][-1]["context"] = (
            "publication-readiness-old"
        )
        errors = guard.live_ruleset_errors(REGISTRY, live)
        self.assertTrue(any("missing required context 'publication-readiness'" in e for e in errors))
        self.assertTrue(any("unknown required context 'publication-readiness-old'" in e for e in errors))

    def test_producer_integration_drift_fails(self) -> None:
        live = self.live_ruleset()
        build = next(
            item
            for item in live["rules"][0]["parameters"]["required_status_checks"]
            if item["context"] == "build-test"
        )
        build["integration_id"] = 99999
        errors = guard.live_ruleset_errors(REGISTRY, live)
        self.assertTrue(any("producer integration drift" in e for e in errors))

    def test_duplicate_required_context_fails(self) -> None:
        live = self.live_ruleset()
        live["rules"][0]["parameters"]["required_status_checks"].append(
            {"context": "build-test", "integration_id": 15368}
        )
        errors = guard.live_ruleset_errors(REGISTRY, live)
        self.assertTrue(any("duplicate required context 'build-test'" in e for e in errors))

    def test_non_strict_ruleset_fails(self) -> None:
        live = self.live_ruleset()
        live["rules"][0]["parameters"]["strict_required_status_checks_policy"] = False
        self.assertTrue(
            any("strict_required_status_checks_policy" in e for e in guard.live_ruleset_errors(REGISTRY, live))
        )


class ExactHeadTests(unittest.TestCase):
    def success_evidence(self, head: str = HEAD) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        checks: list[dict[str, Any]] = []
        statuses: list[dict[str, Any]] = []
        for offset, item in enumerate(REGISTRY["checks"]):
            timestamp = f"2026-09-04T05:{10 + offset:02d}:00Z"
            if item["kind"] == "workflow-job":
                checks.append(
                    {
                        "id": offset + 1,
                        "name": item["context"],
                        "head_sha": head,
                        "status": "completed",
                        "conclusion": "success",
                        "completed_at": timestamp,
                        "app": {"id": 15368, "slug": "github-actions"},
                        "workflow": item["workflow"],
                        "workflow_event": "pull_request",
                        "workflow_head_sha": head,
                    }
                )
            else:
                statuses.append(
                    {
                        "id": offset + 1,
                        "context": item["context"],
                        "sha": head,
                        "state": "success",
                        "updated_at": timestamp,
                        "creator": {"login": "github-actions[bot]"},
                        "workflow": item["workflow"],
                        "workflow_head_sha": head,
                    }
                )
        return checks, statuses

    def test_exact_current_head_all_success_passes(self) -> None:
        checks, statuses = self.success_evidence()
        report = guard.exact_head_report(REGISTRY, HEAD, checks, statuses, now=NOW)
        self.assertEqual("pass", report["decision"])
        self.assertTrue(all(item["decision"] == "pass" for item in report["gates"]))

    def test_previous_head_green_is_ignored(self) -> None:
        checks, statuses = self.success_evidence()
        build = next(item for item in checks if item["name"] == "build-test")
        build["head_sha"] = OLD_HEAD
        build["workflow_head_sha"] = OLD_HEAD
        report = guard.exact_head_report(REGISTRY, HEAD, checks, statuses, now=NOW)
        gate = next(item for item in report["gates"] if item["context"] == "build-test")
        self.assertEqual("fail", report["decision"])
        self.assertEqual("previous-head-only", gate["reason"])

    def test_skipped_cancelled_neutral_never_pass(self) -> None:
        for conclusion in ("skipped", "cancelled", "neutral"):
            with self.subTest(conclusion=conclusion):
                checks, statuses = self.success_evidence()
                build = next(item for item in checks if item["name"] == "build-test")
                build["conclusion"] = conclusion
                report = guard.exact_head_report(REGISTRY, HEAD, checks, statuses, now=NOW)
                gate = next(item for item in report["gates"] if item["context"] == "build-test")
                self.assertEqual("fail", report["decision"])
                self.assertEqual("rejected-conclusion", gate["reason"])

    def test_wrong_producer_same_context_fails(self) -> None:
        checks, statuses = self.success_evidence()
        build = next(item for item in checks if item["name"] == "build-test")
        build["app"] = {"id": 99999, "slug": "other-app"}
        report = guard.exact_head_report(REGISTRY, HEAD, checks, statuses, now=NOW)
        gate = next(item for item in report["gates"] if item["context"] == "build-test")
        self.assertEqual("fail", report["decision"])
        self.assertEqual("producer-drift", gate["reason"])

    def test_expected_producer_wins_when_wrong_producer_also_exists(self) -> None:
        checks, statuses = self.success_evidence()
        build = next(item for item in checks if item["name"] == "build-test")
        wrong = copy.deepcopy(build)
        wrong["id"] = 999
        wrong["app"] = {"id": 99999, "slug": "other-app"}
        wrong["completed_at"] = "2026-09-04T05:29:00Z"
        checks.append(wrong)
        report = guard.exact_head_report(REGISTRY, HEAD, checks, statuses, now=NOW)
        gate = next(item for item in report["gates"] if item["context"] == "build-test")
        self.assertEqual("pass", gate["decision"])
        self.assertEqual("pass", report["decision"])

    def test_in_progress_is_pending_before_timeout(self) -> None:
        checks, statuses = self.success_evidence()
        build = next(item for item in checks if item["name"] == "build-test")
        build["status"] = "in_progress"
        build["conclusion"] = None
        build["started_at"] = "2026-09-04T05:00:00Z"
        report = guard.exact_head_report(REGISTRY, HEAD, checks, statuses, now=NOW)
        gate = next(item for item in report["gates"] if item["context"] == "build-test")
        self.assertEqual("pending", report["decision"])
        self.assertEqual("current-head-pending", gate["reason"])

    def test_in_progress_past_timeout_fails_stale(self) -> None:
        checks, statuses = self.success_evidence()
        publication = next(item for item in checks if item["name"] == "publication-readiness")
        publication["status"] = "in_progress"
        publication["conclusion"] = None
        publication["started_at"] = "2026-09-04T04:00:00Z"
        report = guard.exact_head_report(REGISTRY, HEAD, checks, statuses, now=NOW)
        gate = next(
            item for item in report["gates"] if item["context"] == "publication-readiness"
        )
        self.assertEqual("fail", report["decision"])
        self.assertEqual("pending-timeout", gate["reason"])

    def test_commit_status_wrong_creator_fails(self) -> None:
        checks, statuses = self.success_evidence()
        statuses[0]["creator"] = {"login": "untrusted-bot"}
        report = guard.exact_head_report(REGISTRY, HEAD, checks, statuses, now=NOW)
        gate = next(
            item for item in report["gates"] if item["context"] == "External PR approval policy"
        )
        self.assertEqual("producer-drift", gate["reason"])


class FakeApi:
    def __init__(self, responses: dict[str, Any]) -> None:
        self.responses = responses
        self.calls: list[str] = []

    def get(self, path: str) -> Any:
        self.calls.append(path)
        if path not in self.responses:
            raise RuntimeError(f"unexpected API call: {path}")
        return copy.deepcopy(self.responses[path])


class LiveEvaluatorTests(ExactHeadTests, LiveRulesetTests):
    def test_authoritative_pr_head_is_refetched_from_api(self) -> None:
        checks, statuses = self.success_evidence(OLD_HEAD)
        live = self.live_ruleset()
        responses = {
            "repos/NYGsatoshi/AIPsiteNYG/pulls/42": {
                "state": "open",
                "head": {"sha": HEAD},
            },
            "repos/NYGsatoshi/AIPsiteNYG/rulesets": [
                {"id": 123, "name": REGISTRY["ruleset"]["name"]}
            ],
            "repos/NYGsatoshi/AIPsiteNYG/rulesets/123": live,
            f"repos/NYGsatoshi/AIPsiteNYG/commits/{HEAD}/check-runs?filter=latest&per_page=100": {
                "check_runs": checks
            },
            f"repos/NYGsatoshi/AIPsiteNYG/commits/{HEAD}/statuses?per_page=100": statuses,
        }
        api = FakeApi(responses)
        report = guard.evaluate_live_pr(
            api, "NYGsatoshi/AIPsiteNYG", 42, REGISTRY, now=NOW
        )
        self.assertEqual(HEAD, report["authoritative_head_sha"])
        self.assertEqual("fail", report["decision"])
        self.assertTrue(
            any(gate["reason"] == "previous-head-only" for gate in report["exact_head"]["gates"])
        )
        self.assertEqual("repos/NYGsatoshi/AIPsiteNYG/pulls/42", api.calls[0])


if __name__ == "__main__":
    unittest.main()
