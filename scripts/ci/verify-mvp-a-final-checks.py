#!/usr/bin/env python3
"""Require green MVP-A checks from trusted GitHub Actions for the exact candidate commit."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

GITHUB_ACTIONS_APP_ID = 15368
GITHUB_ACTIONS_APP_SLUG = "github-actions"
PAGE_SIZE = 100
MAX_PAGES = 20
REQUIRED_CHECKS = (
    "build-test",
    "frontend-test",
    "security-scan",
    "publication-readiness",
    "frontend-static-analysis",
    "licensed-real-backend",
    "sbom-source",
    "sbom-image-trusted",
)


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required for MVP-A final check verification.")
    return value


def fetch_page(url: str, token: str, sha: str) -> dict[str, object]:
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

    if not isinstance(payload, dict):
        raise RuntimeError(f"Unable to read check runs for {sha}: GitHub returned a non-object payload.")
    return payload


def fetch_check_runs(repository: str, sha: str, token: str, api_url: str) -> list[dict[str, object]]:
    check_runs: list[dict[str, object]] = []

    for page in range(1, MAX_PAGES + 1):
        url = (
            f"{api_url}/repos/{repository}/commits/{sha}/check-runs"
            f"?per_page={PAGE_SIZE}&page={page}&filter=all"
        )
        payload = fetch_page(url, token, sha)
        raw_items = payload.get("check_runs", [])
        if not isinstance(raw_items, list):
            raise RuntimeError(f"Unable to read check runs for {sha}: 'check_runs' is not a list.")

        items = [item for item in raw_items if isinstance(item, dict)]
        check_runs.extend(items)

        total_count = payload.get("total_count")
        if isinstance(total_count, int) and len(check_runs) >= total_count:
            return check_runs
        if len(raw_items) < PAGE_SIZE:
            return check_runs

    raise RuntimeError(
        f"Unable to read all check runs for {sha}: pagination exceeded {MAX_PAGES} pages."
    )


def check_timestamp(check: dict[str, object]) -> str:
    completed = check.get("completed_at")
    started = check.get("started_at")
    if isinstance(completed, str) and completed:
        return completed
    if isinstance(started, str) and started:
        return started
    return ""


def check_app_identity(check: dict[str, object]) -> tuple[int | None, str]:
    app = check.get("app")
    if not isinstance(app, dict):
        return None, ""

    raw_id = app.get("id")
    app_id = raw_id if isinstance(raw_id, int) else None
    raw_slug = app.get("slug")
    slug = raw_slug if isinstance(raw_slug, str) else ""
    return app_id, slug


def is_trusted_required_check(check: dict[str, object], sha: str) -> bool:
    app_id, slug = check_app_identity(check)
    return (
        check.get("head_sha") == sha
        and app_id == GITHUB_ACTIONS_APP_ID
        and slug == GITHUB_ACTIONS_APP_SLUG
    )


def describe_identities(checks: list[dict[str, object]]) -> str:
    identities = sorted(
        {
            f"{slug or 'unknown'}#{app_id if app_id is not None else 'unknown'}"
            for app_id, slug in (check_app_identity(check) for check in checks)
        }
    )
    return ", ".join(identities) if identities else "none"


def main() -> int:
    repository = required_env("GITHUB_REPOSITORY")
    sha = required_env("GITHUB_SHA")
    token = required_env("GITHUB_TOKEN")
    api_url = os.environ.get("GITHUB_API_URL", "https://api.github.com").strip()
    check_runs = fetch_check_runs(repository, sha, token, api_url)

    failures: list[str] = []
    summary: list[tuple[str, str, str, str, str]] = []

    for name in REQUIRED_CHECKS:
        named_matches = [check for check in check_runs if check.get("name") == name]
        trusted_matches = [
            check for check in named_matches if is_trusted_required_check(check, sha)
        ]
        trusted_matches.sort(key=check_timestamp, reverse=True)

        if not trusted_matches:
            identities = describe_identities(named_matches)
            failures.append(
                f"{name}: no trusted GitHub Actions check run exists for exact SHA {sha}; "
                f"observed identities={identities}"
            )
            summary.append((name, "missing", "none", identities, ""))
            continue

        latest = trusted_matches[0]
        status = str(latest.get("status") or "unknown")
        conclusion = str(latest.get("conclusion") or "none")
        html_url = str(latest.get("html_url") or "")
        app_id, slug = check_app_identity(latest)
        identity = f"{slug}#{app_id}"
        summary.append((name, status, conclusion, identity, html_url))
        if status != "completed" or conclusion != "success":
            failures.append(
                f"{name}: trusted check status={status} conclusion={conclusion} identity={identity}"
            )

    print("MVP-A final check evidence:")
    for name, status, conclusion, identity, html_url in summary:
        suffix = f" {html_url}" if html_url else ""
        print(f"- {name}: {status}/{conclusion} source={identity}{suffix}")

    if failures:
        print("MVP-A final gate failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1

    print(
        f"MVP-A final gate passed: {len(REQUIRED_CHECKS)} required checks are green, "
        f"trusted, and bound to exact SHA {sha}."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from error
