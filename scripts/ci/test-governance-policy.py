#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("validate-governance-policy.py")
SPEC = importlib.util.spec_from_file_location("governance_policy_validator", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load governance policy validator")
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)

REPO_ROOT = Path(__file__).resolve().parents[2]
POLICY = json.loads(
    (REPO_ROOT / "governance" / "policy.json").read_text(encoding="utf-8")
)
SCHEMA = json.loads(
    (REPO_ROOT / "governance" / "policy.schema.json").read_text(encoding="utf-8")
)


class GovernancePolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.policy = copy.deepcopy(POLICY)
        self.schema = copy.deepcopy(SCHEMA)

    def _control(self, family: str) -> dict:
        return next(
            control
            for control in self.policy["controls"]
            if control["family"] == family
        )

    def _fixture_root(self, policy: dict | None = None) -> tempfile.TemporaryDirectory:
        document = copy.deepcopy(policy if policy is not None else self.policy)
        temp = tempfile.TemporaryDirectory()
        root = Path(temp.name)

        governance = root / "governance"
        governance.mkdir(parents=True)
        (governance / "policy.json").write_text(
            json.dumps(document, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        (governance / "policy.schema.json").write_text(
            json.dumps(self.schema, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        (governance / "controls.md").write_text(
            validator.render_controls_markdown(document),
            encoding="utf-8",
        )

        workflow_jobs: dict[str, set[str]] = {}
        referenced_paths: set[str] = set(validator.CRITICAL_SENSITIVE_PATHS)
        for control in document["controls"]:
            references = control["references"]
            referenced_paths.update(references["paths"])
            referenced_paths.update(references["workflows"])
            for check in references["checks"]:
                workflow_jobs.setdefault(check["workflow"], set()).add(check["job"])

        for relative in referenced_paths:
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            if relative.startswith(".github/workflows/"):
                jobs = workflow_jobs.get(relative, set())
                lines = ["name: fixture", "on:", "  pull_request:", "jobs:"]
                if jobs:
                    for job in sorted(jobs):
                        lines.extend(
                            [
                                f"  {job}:",
                                f"    name: {job}",
                                "    runs-on: ubuntu-latest",
                            ]
                        )
                else:
                    lines.extend(
                        [
                            "  fixture:",
                            "    name: fixture",
                            "    runs-on: ubuntu-latest",
                        ]
                    )
                path.write_text("\n".join(lines) + "\n", encoding="utf-8")
            elif not path.exists():
                path.write_text("fixture\n", encoding="utf-8")

        return temp

    def _schema_errors(self) -> list[str]:
        return validator.validate_against_schema(self.policy, self.schema)

    def test_expected_good_fixture_passes(self) -> None:
        with self._fixture_root() as root_name:
            errors = validator.repository_errors(Path(root_name))
        self.assertEqual([], errors)

    def test_duplicate_control_id_fails(self) -> None:
        self.policy["controls"][1]["id"] = self.policy["controls"][0]["id"]
        errors = validator.validate_policy_semantics(self.policy)
        self.assertTrue(any("duplicate control ID" in error for error in errors))

    def test_unknown_enforcement_fails(self) -> None:
        self.policy["controls"][0]["enforcement"] = "soft"
        errors = self._schema_errors()
        self.assertTrue(any("enforcement" in error and "enum" in error for error in errors))

    def test_blocking_control_owner_missing_fails(self) -> None:
        self.policy["controls"][0].pop("owner")
        errors = validator.validate_policy_semantics(self.policy)
        self.assertTrue(any("blocking control owner is missing" in error for error in errors))

    def test_nonexistent_required_check_workflow_reference_fails(self) -> None:
        control = self._control("required-status-checks")
        missing = {
            "workflow": ".github/workflows/does-not-exist.yml",
            "job": "missing-check",
            "context": "missing-check",
        }
        control["expected"]["required"].append(copy.deepcopy(missing))
        control["references"]["checks"].append(copy.deepcopy(missing))
        control["references"]["workflows"].append(missing["workflow"])

        with self._fixture_root(self.policy) as root_name:
            root = Path(root_name)
            missing_path = root / missing["workflow"]
            if missing_path.exists():
                missing_path.unlink()
            errors = validator.validate_policy_semantics(self.policy, root)

        self.assertTrue(
            any("required check workflow" in error and "does not exist" in error for error in errors)
        )

    def test_sensitive_path_typo_that_matches_nothing_fails(self) -> None:
        control = self._control("governance-sensitive-paths")
        control["expected"]["patterns"] = ["governance-typo/**"]
        with self._fixture_root(self.policy) as root_name:
            errors = validator.validate_policy_semantics(
                self.policy, Path(root_name)
            )
        self.assertTrue(any("matches no repository files" in error for error in errors))

    def test_overbroad_sensitive_path_fails(self) -> None:
        control = self._control("governance-sensitive-paths")
        control["expected"]["patterns"] = ["**"]
        with self._fixture_root(self.policy) as root_name:
            errors = validator.validate_policy_semantics(
                self.policy, Path(root_name)
            )
        self.assertTrue(any("over-broad catch-all" in error for error in errors))

    def test_unknown_control_field_fails(self) -> None:
        self.policy["controls"][0]["mystery"] = True
        errors = self._schema_errors()
        self.assertTrue(any("unknown field 'mystery'" in error for error in errors))

    def test_unknown_expected_field_fails(self) -> None:
        self.policy["controls"][0]["expected"]["strictish"] = True
        errors = self._schema_errors()
        self.assertTrue(any("unknown field 'strictish'" in error for error in errors))

    def test_exceptionable_control_without_waiver_rule_fails(self) -> None:
        control = self._control("action-refs")
        control["exception"] = {"allowed": True}
        errors = validator.validate_policy_semantics(self.policy)
        self.assertTrue(any("must name a waiver rule" in error for error in errors))

    def test_expected_checks_and_reference_checks_cannot_drift(self) -> None:
        control = self._control("required-status-checks")
        control["references"]["checks"].pop()
        errors = validator.validate_policy_semantics(self.policy)
        self.assertTrue(
            any("expected.required and references.checks must be identical" in error for error in errors)
        )


if __name__ == "__main__":
    unittest.main()
