#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path
from typing import Any

MODULE_PATH = Path(__file__).with_name("verify-mvp-a-final-checks.py")
SPEC = importlib.util.spec_from_file_location("mvp_a_final_checks", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load MVP-A final check verifier")
verifier = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verifier)

HEAD = "a" * 40
OLD_HEAD = "b" * 40


def check_run(
    name: str,
    run_id: int,
    *,
    status: str = "completed",
    conclusion: str | None = "success",
    head_sha: str = HEAD,
    started_at: str | None = "2026-09-06T05:00:00Z",
    completed_at: str | None = "2026-09-06T05:10:00Z",
) -> dict[str, Any]:
    return {
        "id": run_id,
        "name": name,
        "head_sha": head_sha,
        "status": status,
        "conclusion": conclusion,
        "started_at": started_at,
        "completed_at": completed_at,
        "app": {
            "id": verifier.GITHUB_ACTIONS_APP_ID,
            "slug": verifier.GITHUB_ACTIONS_APP_SLUG,
        },
    }


def successful_evidence() -> list[dict[str, Any]]:
    return [
        check_run(name, 1000 + offset)
        for offset, name in enumerate(verifier.REQUIRED_CHECKS)
    ]


class LatestRequiredCheckTests(unittest.TestCase):
    def evaluate(self, checks: list[dict[str, Any]]) -> tuple[list[str], dict[str, bool]]:
        failures, summary = verifier.evaluate_required_checks(checks, HEAD)
        return failures, dict(summary)

    def test_all_latest_exact_head_checks_success(self) -> None:
        failures, summary = self.evaluate(successful_evidence())
        self.assertEqual([], failures)
        self.assertTrue(all(summary.values()))

    def test_newer_queued_check_without_timestamps_cannot_be_masked_by_old_success(self) -> None:
        checks = successful_evidence()
        old = next(check for check in checks if check["name"] == "build-test")
        old["id"] = 2000
        old["completed_at"] = "2026-09-06T06:00:00Z"
        checks.append(
            check_run(
                "build-test",
                2001,
                status="queued",
                conclusion=None,
                started_at=None,
                completed_at=None,
            )
        )

        failures, summary = self.evaluate(checks)

        self.assertFalse(summary["build-test"])
        self.assertTrue(any("build-test: latest trusted check" in failure for failure in failures))

    def test_newer_in_progress_check_cannot_be_masked_by_old_success_finishing_later(self) -> None:
        checks = successful_evidence()
        old = next(check for check in checks if check["name"] == "frontend-static-analysis")
        old["id"] = 2500
        old["completed_at"] = "2026-09-06T06:20:00Z"
        checks.append(
            check_run(
                "frontend-static-analysis",
                2501,
                status="in_progress",
                conclusion=None,
                started_at="2026-09-06T06:10:00Z",
                completed_at=None,
            )
        )

        failures, summary = self.evaluate(checks)

        self.assertFalse(summary["frontend-static-analysis"])
        self.assertTrue(
            any(
                "frontend-static-analysis: latest trusted check" in failure
                for failure in failures
            )
        )

    def test_newer_failure_cannot_be_masked_by_old_success_with_later_timestamp(self) -> None:
        checks = successful_evidence()
        old = next(check for check in checks if check["name"] == "security-scan")
        old["id"] = 3000
        old["completed_at"] = "2026-09-06T07:00:00Z"
        checks.append(
            check_run(
                "security-scan",
                3001,
                conclusion="failure",
                started_at="2026-09-06T05:30:00Z",
                completed_at="2026-09-06T05:40:00Z",
            )
        )

        failures, summary = self.evaluate(checks)

        self.assertFalse(summary["security-scan"])
        self.assertTrue(any("security-scan: latest trusted check" in failure for failure in failures))

    def test_missing_exact_head_check_fails_even_when_old_head_succeeded(self) -> None:
        checks = successful_evidence()
        publication = next(check for check in checks if check["name"] == "publication-readiness")
        publication["head_sha"] = OLD_HEAD

        failures, summary = self.evaluate(checks)

        self.assertFalse(summary["publication-readiness"])
        self.assertTrue(any("publication-readiness: no trusted" in failure for failure in failures))

    def test_newer_success_replaces_old_failure(self) -> None:
        checks = successful_evidence()
        current = next(check for check in checks if check["name"] == "frontend-test")
        current["id"] = 4001
        checks.append(
            check_run(
                "frontend-test",
                4000,
                conclusion="failure",
                completed_at="2026-09-06T08:00:00Z",
            )
        )

        failures, summary = self.evaluate(checks)

        self.assertTrue(summary["frontend-test"])
        self.assertFalse(any(failure.startswith("frontend-test:") for failure in failures))

    def test_invalid_check_run_id_fails_closed(self) -> None:
        checks = successful_evidence()
        build = next(check for check in checks if check["name"] == "build-test")
        build.pop("id")

        failures, summary = self.evaluate(checks)

        self.assertFalse(summary["build-test"])
        self.assertTrue(
            any(
                "build-test: trusted check run has an invalid or missing id" == failure
                for failure in failures
            )
        )


if __name__ == "__main__":
    unittest.main()
