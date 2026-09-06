from __future__ import annotations

import importlib.util
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE_TEST_PATH = ROOT / "tests" / "ci" / "test_performance_comparator.py"
VALIDATOR_PATH = ROOT / "scripts" / "ci" / "verify-performance-baseline-updates.py"

spec = importlib.util.spec_from_file_location("performance_comparator_base_tests", BASE_TEST_PATH)
assert spec is not None and spec.loader is not None
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


class PerformanceComparatorHardeningTests(unittest.TestCase):
    def test_boolean_attempt_is_invalid_not_successful_attempt_one(self) -> None:
        current = base.measurement([100, 101, 102, 103, 104])
        current["attempt"] = True
        result = base.compare.compare_documents(
            current,
            base.approved_baseline([95, 96, 97, 98, 99]),
            base.fingerprint(),
            base.scenarios(),
            base.budgets(),
            base.environment(),
            base.policy(),
        )
        self.assertEqual("invalid", result["decision"])
        self.assertEqual("rerun-limit-exceeded", result["reasonCode"])
        self.assertIsNone(result["attempt"])

    def test_blocking_budget_removal_is_rejected(self) -> None:
        old_budgets = base.budgets()
        new_budgets = {"schemaVersion": 1, "budgets": []}
        with self.assertRaisesRegex(base.baseline_updates.BaselineUpdateError, "blocking budget removal"):
            base.baseline_updates.validate_transition(
                old_budgets,
                new_budgets,
                base.ledger(),
                head_sha=base.HEAD,
            )

    def test_baseline_validator_requires_base_and_head_as_a_pair(self) -> None:
        for args in (["--base-ref", "HEAD"], ["--head-sha", base.HEAD]):
            completed = subprocess.run(
                [sys.executable, str(VALIDATOR_PATH), *args],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(0, completed.returncode, args)
            self.assertIn("must be supplied together", completed.stderr)

    def test_comparison_policy_indicator_drift_is_invalid(self) -> None:
        changed_policy = base.policy()
        changed_policy["variability"]["defaultIndicator"] = "cv"
        result = base.compare.compare_documents(
            base.measurement([100, 101, 102, 103, 104]),
            base.approved_baseline([95, 96, 97, 98, 99]),
            base.fingerprint(),
            base.scenarios(),
            base.budgets(),
            base.environment(),
            changed_policy,
        )
        self.assertEqual("invalid", result["decision"])
        self.assertEqual("invalid-policy", result["reasonCode"])


if __name__ == "__main__":
    unittest.main()
