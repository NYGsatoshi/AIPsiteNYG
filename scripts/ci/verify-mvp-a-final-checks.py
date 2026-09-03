#!/usr/bin/env python3
"""Require green MVP-A checks for the exact candidate commit."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

REQUIRED_CHECKS = (
    "build-test",
    "frontend-test",
    "security-scan",
    "publication-readiness",
    "frontend-static-analysis",
    "licensed-real-backend",
)


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required for MVP-A final check verification.")
    return value


def fetch_check_runs(repository: str, sha: str, token: str, api_url: str) -> list[dict[str, object]]:
    url = f"{api_url}/repos/{repository}/commits/{sha}/check-runs?per_page=100"
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "aipsite-mvp-a-final-gate",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(
            f"Unable to read check runs for {sha}: HTTP {error.code}."
        ) from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Unable to read check runs for {sha}: {error.reason}.") from error

    check_runs = payload.get("check_runs", []) if isinstance(payload, dict) else []
    return [item for item in check_runs if isinstance(item, dict)]


def check_timestamp(check: dict[str, object]) -> str:
    completed = check.get("completed_at")
    started = check.get("started_at")
    if isinstance(completed, str) and completed:
        return completed
    if isinstance(started, str) and started:
        return started
    return ""


def main() -> int:
    repository = required_env("GITHUB_REPOSITORY")
    sha = required_env("GITHUB_SHA")
    token = required_env("GITHUB_TOKEN")
    api_url = os.environ.get("GITHUB_API_URL", "https://api.github.com").strip()
    check_runs = fetch_check_runs(repository, sha, token, api_url)

    failures: list[str] = []
    summary: list[tuple[str, str, str, str]] = []

    for name in REQUIRED_CHECKS:
        matches = [check for check in check_runs if check.get("name") == name]
        matches.sort(key=check_timestamp, reverse=True)
        if not matches:
            failures.append(f"{name}: no check run exists for {sha}")
            summary.append((name, "missing", "none", ""))
            continue

        latest = matches[0]
        status = str(latest.get("status") or "unknown")
        conclusion = str(latest.get("conclusion") or "none")
        html_url = str(latest.get("html_url") or "")
        summary.append((name, status, conclusion, html_url))
        if status != "completed" or conclusion != "success":
            failures.append(f"{name}: status={status} conclusion={conclusion}")

    print("MVP-A final check evidence:")
    for name, status, conclusion, html_url in summary:
        suffix = f" {html_url}" if html_url else ""
        print(f"- {name}: {status}/{conclusion}{suffix}")

    if failures:
        print("MVP-A final gate failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1

    print(
        f"MVP-A final gate passed: {len(REQUIRED_CHECKS)} required checks are green for {sha}."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from error
