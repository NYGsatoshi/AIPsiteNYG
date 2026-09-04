#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]

def load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {filename}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

check = load("governance_invariants", "check-governance-review-status-invariants.py")
evaluate = load("governance_review_evaluator", "evaluate-governance-pr-review.py")
POLICY = json.loads((ROOT / "governance/policy.json").read_text(encoding="utf-8"))


class GovernanceInvariantTests(unittest.TestCase):
    def fixture(self, codeowners: str | None = None) -> tempfile.TemporaryDirectory:
        temp = tempfile.TemporaryDirectory()
        root = Path(temp.name)
        (root / "governance").mkdir(parents=True)
        (root / "governance/policy.json").write_text(json.dumps(POLICY, indent=2) + "\n", encoding="utf-8")
        (root / ".github/workflows").mkdir(parents=True)
        (root / "scripts/ci").mkdir(parents=True)
        if codeowners is None:
            review = next(c for c in POLICY["controls"] if c["id"] == "GOV-REVIEW-001")["expected"]
            lines = ["* @NYGsatoshi"] + [f"{p} @NYGsatoshi" for p in review["codeowners_required_explicit_patterns"]]
            codeowners = "\n".join(lines) + "\n"
        (root / ".github/CODEOWNERS").write_text(codeowners, encoding="utf-8")

        review = next(c for c in POLICY["controls"] if c["id"] == "GOV-REVIEW-001")["expected"]
        for relative in review["codeowners_sensitive_paths"]:
            path = root / relative
            if relative.endswith("/"):
                path = path / "README.md"
            path.parent.mkdir(parents=True, exist_ok=True)
            if not path.exists():
                path.write_text("fixture\n", encoding="utf-8")

        checks = next(c for c in POLICY["controls"] if c["id"] == "GOV-CHECKS-001")
        for item in checks["expected"]["required"]:
            path = root / item["workflow"]
            path.parent.mkdir(parents=True, exist_ok=True)
            if item["kind"] == "commit-status":
                path.write_text(
                    "name: fixture\non:\n  workflow_run:\njobs:\n  evaluate:\n"
                    "    runs-on: ubuntu-latest\n    steps:\n      - run: |\n"
                    "          default_branch=main\n          policy_path=governance/policy.json\n"
                    "          check_id=GOV-CHECKS-001\n          family=required-status-checks\n"
                    "          kind=commit-status\n          status_context=dynamic\n"
                    "          review_id=GOV-REVIEW-001\n          reviewer=external_pr_approval_reviewer\n"
                    "          evaluator=scripts/ci/evaluate-governance-pr-review.py\n",
                    encoding="utf-8",
                )
            else:
                existing = path.read_text(encoding="utf-8") if path.exists() else "name: fixture\non:\n  pull_request:\njobs:\n"
                if item["job"] not in check._workflow_job_ids(existing):
                    if "jobs:\n" not in existing:
                        existing += "jobs:\n"
                    existing += f"  {item['job']}:\n    runs-on: ubuntu-latest\n"
                    path.write_text(existing, encoding="utf-8")
        return temp

    def test_good_fixture_passes(self) -> None:
        with self.fixture() as root_name:
            self.assertEqual([], check.repository_errors(Path(root_name)))

    def test_sensitive_path_owner_removal_fails(self) -> None:
        review = next(c for c in POLICY["controls"] if c["id"] == "GOV-REVIEW-001")["expected"]
        lines = ["* @NYGsatoshi"] + [f"{p} @NYGsatoshi" for p in review["codeowners_required_explicit_patterns"] if p != "/governance/"]
        lines += ["/governance/ # intentionally ownerless"]
        with self.fixture("\n".join(lines) + "\n") as root_name:
            errors = check.repository_errors(Path(root_name))
        self.assertTrue(any("/governance/" in error and ("no owner" in error or "ownerless" in error) for error in errors))

    def test_wildcard_cannot_rescue_ownerless_critical_override(self) -> None:
        review = next(c for c in POLICY["controls"] if c["id"] == "GOV-REVIEW-001")["expected"]
        lines = ["* @NYGsatoshi"] + [f"{p} @NYGsatoshi" for p in review["codeowners_required_explicit_patterns"]]
        lines.append("/governance/policy.json")
        with self.fixture("\n".join(lines) + "\n") as root_name:
            errors = check.repository_errors(Path(root_name))
        self.assertTrue(any("pattern 'governance/policy.json' has no owner" in error or "policy.json" in error and "effective CODEOWNER" in error for error in errors))

    def test_single_owner_native_approval_deadlock_fails(self) -> None:
        policy = copy.deepcopy(POLICY)
        review = next(c for c in policy["controls"] if c["id"] == "GOV-REVIEW-001")
        review["expected"]["approvals_required"] = 1
        errors = check._review_contract_errors(policy)
        self.assertTrue(any("single-owner topology" in error for error in errors))

    def test_live_review_ruleset_weakened_or_deadlocking_fails(self) -> None:
        live = {"name":"PRreview","rules":[{"type":"pull_request","parameters":{
            "required_approving_review_count":1,
            "dismiss_stale_reviews_on_push":False,
            "require_code_owner_review":True,
            "require_last_push_approval":False,
            "required_review_thread_resolution":False,
            "require_extra_approval_for_unattributed_changes":True,
        }}]}
        errors = check.review_ruleset_drift_errors(POLICY, live)
        self.assertTrue(any("required_approving_review_count" in error for error in errors))
        self.assertTrue(any("require_code_owner_review" in error for error in errors))
        self.assertTrue(any("required_review_thread_resolution" in error for error in errors))

    def test_expected_review_ruleset_passes_drift_comparison(self) -> None:
        expected = next(c for c in POLICY["controls"] if c["id"] == "GOV-REVIEW-001")["expected"]
        live = {"name":"PRreview","rules":[{"type":"pull_request","parameters":{
            "required_approving_review_count":expected["approvals_required"],
            "dismiss_stale_reviews_on_push":expected["dismiss_stale_reviews_on_push"],
            "require_code_owner_review":expected["codeowners_review_required"],
            "require_last_push_approval":expected["require_last_push_approval"],
            "required_review_thread_resolution":expected["required_review_thread_resolution"],
            "require_extra_approval_for_unattributed_changes":expected["unattributed_changes_require_additional_approval"],
        }}]}
        self.assertEqual([], check.review_ruleset_drift_errors(POLICY, live))

    def test_unexpected_bypass_actor_fails(self) -> None:
        live = [{"name": "PRreview", "bypass_actors": [{"actor_id": 285141121, "actor_type": "User", "bypass_mode": "always"}]}]
        errors = check.bypass_drift_errors(POLICY, live)
        self.assertTrue(any("unexpected bypass actor" in error for error in errors))

    def test_removing_allowlisted_bypass_is_tightening_not_drift(self) -> None:
        policy = copy.deepcopy(POLICY)
        bypass = next(c for c in policy["controls"] if c["id"] == "GOV-BYPASS-001")
        bypass["expected"]["allowed_actors"] = [{
            "actor_type":"Integration","actor_id":42,"bypass_mode":"pull_request",
            "purpose":"fixture automation","rationale":"fixture rationale","break_glass":False,
            "normal_development":False,"rulesets":["PRreview"]
        }]
        self.assertEqual([], check.bypass_drift_errors(policy, [{"name":"PRreview","bypass_actors":[]}]))

    def review_state(self, **overrides):
        base = {
            "state":"open","draft":False,"head_sha":"b" * 40,"author":"external-user",
            "reviews":[{
                "user":{"login":"NYGsatoshi"},"commit_id":"b" * 40,"state":"APPROVED","submitted_at":"2026-09-04T00:00:00Z"
            }]
        }
        base.update(overrides)
        return base

    def test_approved_expected_state_passes(self) -> None:
        self.assertEqual("success", evaluate.evaluate(POLICY, self.review_state())["state"])

    def test_external_pr_without_current_head_approval_fails(self) -> None:
        state = self.review_state(reviews=[])
        self.assertEqual("failure", evaluate.evaluate(POLICY, state)["state"])

    def test_previous_head_only_approval_fails(self) -> None:
        state = self.review_state(reviews=[{"user":{"login":"NYGsatoshi"},"commit_id":"a" * 40,"state":"APPROVED","submitted_at":"2026-09-04T00:00:00Z"}])
        result = evaluate.evaluate(POLICY, state)
        self.assertEqual("failure", result["state"])
        self.assertIn("Current head", result["reason"])

    def test_dismissed_current_head_approval_fails(self) -> None:
        state = self.review_state(reviews=[{"user":{"login":"NYGsatoshi"},"commit_id":"b" * 40,"state":"DISMISSED","submitted_at":"2026-09-04T00:00:00Z"}])
        self.assertEqual("failure", evaluate.evaluate(POLICY, state)["state"])

    def test_changes_requested_fails(self) -> None:
        state = self.review_state(reviews=[{"user":{"login":"NYGsatoshi"},"commit_id":"b" * 40,"state":"CHANGES_REQUESTED","submitted_at":"2026-09-04T00:00:00Z"}])
        self.assertEqual("failure", evaluate.evaluate(POLICY, state)["state"])

    def test_unresolved_review_thread_policy_is_native_and_blocking(self) -> None:
        expected = next(c for c in POLICY["controls"] if c["id"] == "GOV-REVIEW-001")["expected"]
        self.assertTrue(expected["required_review_thread_resolution"])
        live = {"name":"PRreview","rules":[{"type":"pull_request","parameters":{
            "required_approving_review_count":expected["approvals_required"],
            "dismiss_stale_reviews_on_push":expected["dismiss_stale_reviews_on_push"],
            "require_code_owner_review":expected["codeowners_review_required"],
            "require_last_push_approval":expected["require_last_push_approval"],
            "required_review_thread_resolution":False,
            "require_extra_approval_for_unattributed_changes":expected["unattributed_changes_require_additional_approval"],
        }}]}
        errors = check.review_ruleset_drift_errors(POLICY, live)
        self.assertTrue(any("required_review_thread_resolution" in error for error in errors))

    def test_draft_pr_fails(self) -> None:
        self.assertEqual("failure", evaluate.evaluate(POLICY, self.review_state(draft=True))["state"])

    def test_owner_authored_pr_passes_without_self_review(self) -> None:
        state = self.review_state(author="NYGsatoshi", reviews=[])
        self.assertEqual("success", evaluate.evaluate(POLICY, state)["state"])

if __name__ == "__main__":
    unittest.main()
