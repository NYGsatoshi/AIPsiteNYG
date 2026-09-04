#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("check-required-pr-checks.py")
SPEC = importlib.util.spec_from_file_location("required_check_guard", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load required PR check guard")
guard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)


class RequiredPrCheckPolicyTests(unittest.TestCase):
    def ci_errors(self, text: str) -> list[str]:
        return guard.required_check_errors(".github/workflows/ci.yml", text)

    def publication_errors(self, text: str) -> list[str]:
        return guard.required_check_errors(
            ".github/workflows/publication-readiness.yml", text
        )

    def test_policy_includes_trusted_commit_status(self) -> None:
        statuses = guard.REQUIRED_STATUS_CHECKS
        self.assertEqual(5, len(statuses))
        commit_statuses = [item for item in statuses if item["kind"] == "commit-status"]
        self.assertEqual(1, len(commit_statuses))
        self.assertEqual(
            ".github/workflows/external-pr-approval-evaluator.yml",
            commit_statuses[0]["workflow"],
        )
        self.assertEqual("evaluate", commit_statuses[0]["job"])

    def test_unfiltered_required_jobs_are_accepted(self) -> None:
        text = """
name: CI
on:
  pull_request:
jobs:
  build-test:
    name: build-test
    runs-on: ubuntu-latest
  frontend-test:
    name: frontend-test
    runs-on: ubuntu-latest
  security-scan:
    name: security-scan
    runs-on: ubuntu-latest
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
"""
        errors = self.publication_errors(text)
        self.assertTrue(any("job-level if" in error for error in errors))

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
"""
        errors = self.publication_errors(text)
        self.assertTrue(any("must not depend" in error for error in errors))

    def test_required_job_continue_on_error_is_rejected(self) -> None:
        text = """
on:
  pull_request:
jobs:
  publication-readiness:
    name: publication-readiness
    continue-on-error: true
    runs-on: ubuntu-latest
"""
        errors = self.publication_errors(text)
        self.assertTrue(any("continue-on-error" in error for error in errors))

    def test_required_job_name_change_is_rejected(self) -> None:
        text = """
on:
  pull_request:
jobs:
  publication-readiness:
    name: renamed-check
    runs-on: ubuntu-latest
"""
        errors = self.publication_errors(text)
        self.assertTrue(any("must keep name" in error for error in errors))

    def test_missing_required_job_is_rejected(self) -> None:
        text = """
on:
  pull_request:
jobs:
  publication-readiness:
    name: publication-readiness
    runs-on: ubuntu-latest
"""
        errors = self.ci_errors(text)
        self.assertTrue(any("required check job 'build-test' is missing" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
