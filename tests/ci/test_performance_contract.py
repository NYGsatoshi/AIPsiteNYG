from __future__ import annotations

import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
VALIDATOR_PATH = REPO_ROOT / "scripts" / "ci" / "verify-performance-contract.py"
spec = importlib.util.spec_from_file_location("verify_performance_contract", VALIDATOR_PATH)
assert spec is not None and spec.loader is not None
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class PerformanceContractValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        shutil.copytree(REPO_ROOT / "performance", self.root / "performance")

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def read(self, name: str) -> dict:
        return json.loads((self.root / "performance" / name).read_text(encoding="utf-8"))

    def write(self, name: str, value: dict, *, allow_nan: bool = True) -> None:
        (self.root / "performance" / name).write_text(
            json.dumps(value, indent=2, allow_nan=allow_nan) + "\n",
            encoding="utf-8",
        )

    def test_repository_contract_is_valid_and_deterministic(self) -> None:
        first = validator.validate_contract(REPO_ROOT)
        second = validator.validate_contract(REPO_ROOT)
        self.assertEqual(first, second)
        self.assertEqual(first["blockingBudgets"], 1)
        self.assertEqual(first["profiles"], ["large", "medium", "small"])

    def test_duplicate_scenario_id_is_rejected(self) -> None:
        document = self.read("scenarios.json")
        document["scenarios"].append(document["scenarios"][0])
        self.write("scenarios.json", document)
        with self.assertRaisesRegex(validator.ContractError, "duplicate scenario id"):
            validator.validate_contract(self.root)

    def test_unknown_metric_is_rejected(self) -> None:
        document = self.read("scenarios.json")
        document["scenarios"][0]["metrics"][0]["name"] = "api.latency.average_ms"
        self.write("scenarios.json", document)
        with self.assertRaisesRegex(validator.ContractError, "unknown metric"):
            validator.validate_contract(self.root)

    def test_unknown_gate_class_is_rejected(self) -> None:
        document = self.read("scenarios.json")
        document["scenarios"][0]["metrics"][0]["gate"] = "warn-only"
        self.write("scenarios.json", document)
        with self.assertRaisesRegex(validator.ContractError, "unknown gate class"):
            validator.validate_contract(self.root)

    def test_budget_without_rationale_is_rejected(self) -> None:
        document = self.read("budgets.json")
        document["budgets"][0]["rationale"] = ""
        self.write("budgets.json", document)
        with self.assertRaisesRegex(validator.ContractError, "rationale"):
            validator.validate_contract(self.root)

    def test_relative_regression_budget_without_baseline_identity_is_rejected(self) -> None:
        scenarios = self.read("scenarios.json")
        auth = next(item for item in scenarios["scenarios"] if item["id"] == "auth.session-bootstrap")
        p95 = next(metric for metric in auth["metrics"] if metric["name"] == "api.latency.p95_ms")
        p95["gate"] = "relative-regression"
        self.write("scenarios.json", scenarios)

        budgets = self.read("budgets.json")
        budgets["budgets"].append(
            {
                "id": "auth.p95.relative",
                "scenarioId": "auth.session-bootstrap",
                "metric": "api.latency.p95_ms",
                "gate": "relative-regression",
                "rationale": "Regression example must carry an approved baseline identity and evidence.",
                "baseline": {
                    "identity": "",
                    "sha": "79efe27722e3b9c2ddc2d6d5eed5010299e4df32",
                    "date": "2026-09-04",
                    "sourceKind": "measurement",
                    "evidence": ["artifacts/performance/baseline.json"]
                },
                "comparison": {"maxIncreasePercent": 10}
            }
        )
        self.write("budgets.json", budgets)
        with self.assertRaisesRegex(validator.ContractError, "baseline.identity"):
            validator.validate_contract(self.root)

    def test_large_gantt_page_size_above_current_contract_is_rejected(self) -> None:
        document = self.read("datasets.json")
        document["profiles"]["large"]["gantt"]["requestedPageSize"] = 201
        self.write("datasets.json", document)
        with self.assertRaisesRegex(validator.ContractError, "exceeds #270 maximum 200"):
            validator.validate_contract(self.root)

    def test_large_gantt_cannot_be_collapsed_to_old_full_snapshot_limits(self) -> None:
        document = self.read("datasets.json")
        document["profiles"]["large"]["focus"]["projectTasks"] = 400
        document["profiles"]["large"]["focus"]["projectMilestones"] = 100
        document["profiles"]["large"]["focus"]["projectDependencies"] = 2000
        document["profiles"]["large"]["gantt"]["totalItems"] = 500
        document["profiles"]["large"]["gantt"]["dependencies"] = 2000
        document["profiles"]["large"]["gantt"]["expectedPages"] = 3
        document["profiles"]["large"]["expectedPagination"]["taskList"]["cardinality"] = 400
        document["profiles"]["large"]["expectedPagination"]["taskList"]["pages"] = 8
        self.write("datasets.json", document)
        with self.assertRaisesRegex(validator.ContractError, "historical PR06 500/2000"):
            validator.validate_contract(self.root)

    def test_infinity_budget_is_rejected(self) -> None:
        document = self.read("budgets.json")
        document["budgets"][0]["limit"]["value"] = float("inf")
        self.write("budgets.json", document, allow_nan=True)
        with self.assertRaisesRegex(validator.ContractError, "non-standard numeric constant"):
            validator.validate_contract(self.root)

    def test_missing_contract_file_fails_closed(self) -> None:
        (self.root / "performance" / "budgets.json").unlink()
        with self.assertRaisesRegex(validator.ContractError, "missing required contract file"):
            validator.validate_contract(self.root)


if __name__ == "__main__":
    unittest.main()
