#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("check-governance-review-status-invariants.py")
SPEC = importlib.util.spec_from_file_location("governance_invariants", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load governance invariant validator")
check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check)

ROOT = Path(__file__).resolve().parents[2]
POLICY = json.loads((ROOT / "governance/policy.json").read_text(encoding="utf-8"))


class GovernanceInvariantTests(unittest.TestCase):
    def fixture(self, owners: str = "@alpha @beta") -> tempfile.TemporaryDirectory:
        temp = tempfile.TemporaryDirectory()
        root = Path(temp.name)
        (root / "governance").mkdir(parents=True)
        (root / "governance/policy.json").write_text(
            json.dumps(POLICY, indent=2) + "\n", encoding="utf-8"
        )
        (root / ".github/workflows").mkdir(parents=True)
        (root / ".github/CODEOWNERS").write_text(
            f"* {owners}\n/.github/ {owners}\n/scripts/ci/ {owners}\n/governance/ {owners}\n",
            encoding="utf-8",
        )
        (root / "scripts/ci").mkdir(parents=True)
        for relative in check.CRITICAL_GOVERNANCE_PATHS:
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            if path.exists():
                continue
            if relative == ".github/workflows/external-pr-approval-evaluator.yml":
                path.write_text(
                    "name: fixture\non:\n  workflow_run:\njobs:\n  evaluate:\n"
                    "    name: evaluate\n    runs-on: ubuntu-latest\n    steps:\n"
                    "      - run: |\n"
                    "          default_branch=main\n"
                    "          policy_path=governance/policy.json\n"
                    "          check_id=GOV-CHECKS-001\n"
                    "          family=required-status-checks\n"
                    "          kind=commit-status\n"
                    "          status_context=dynamic\n"
                    "          review_id=GOV-REVIEW-001\n"
                    "          reviewer=external_pr_approval_reviewer\n",
                    encoding="utf-8",
                )
            elif relative.startswith(".github/workflows/"):
                path.write_text("name: fixture\non:\n  pull_request:\njobs:\n  fixture:\n    name: fixture\n    runs-on: ubuntu-latest\n", encoding="utf-8")
            else:
                path.write_text("fixture\n", encoding="utf-8")

        checks = next(c for c in POLICY["controls"] if c["id"] == "GOV-CHECKS-001")
        for item in checks["expected"]["required"]:
            path = root / item["workflow"]
            path.parent.mkdir(parents=True, exist_ok=True)
            if item["kind"] == "workflow-job":
                existing = path.read_text(encoding="utf-8") if path.exists() else "name: fixture\non:\n  pull_request:\njobs:\n"
                if item["job"] not in check._workflow_job_ids(existing):
                    if "jobs:\n" not in existing:
                        existing += "jobs:\n"
                    existing += f"  {item['job']}:\n    name: {item['job']}\n    runs-on: ubuntu-latest\n"
                    path.write_text(existing, encoding="utf-8")
        return temp

    def test_good_fixture_passes(self) -> None:
        with self.fixture() as root_name:
            self.assertEqual([], check.repository_errors(Path(root_name)))

    def test_singleton_codeowner_fails(self) -> None:
        with self.fixture("@alpha") as root_name:
            errors = check.repository_errors(Path(root_name))
        self.assertTrue(any("at least 2 distinct owners" in error for error in errors))

    def test_hardcoded_status_context_fails(self) -> None:
        status = next(
            item
            for control in POLICY["controls"] if control["id"] == "GOV-CHECKS-001"
            for item in control["expected"]["required"] if item["kind"] == "commit-status"
        )
        with self.fixture() as root_name:
            root = Path(root_name)
            path = root / status["workflow"]
            path.write_text(path.read_text(encoding="utf-8") + status["context"] + "\n", encoding="utf-8")
            errors = check.repository_errors(root)
        self.assertTrue(any("hard-coded" in error for error in errors))

    def test_missing_policy_lookup_proof_fails(self) -> None:
        status = next(
            item
            for control in POLICY["controls"] if control["id"] == "GOV-CHECKS-001"
            for item in control["expected"]["required"] if item["kind"] == "commit-status"
        )
        with self.fixture() as root_name:
            root = Path(root_name)
            path = root / status["workflow"]
            text = path.read_text(encoding="utf-8").replace("status_context", "renamed_context")
            path.write_text(text, encoding="utf-8")
            errors = check.repository_errors(root)
        self.assertTrue(any("status_context" in error and "missing" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
