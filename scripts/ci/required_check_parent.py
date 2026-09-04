#!/usr/bin/env python3
"""Trusted-parent adapter for GOV-06 exact-head evaluation.

The trusted Governance parent is itself the producer of one registered commit-status.
It may mark only that single stable all-PR commit-status as logically satisfied while
GOV-06 still validates the complete live ruleset and every other exact-head gate.
"""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import json
import os
import re
from pathlib import Path
from typing import Any

import required_check_contract as guard


def _parent_gate(registry: dict[str, Any], gate_id: str) -> dict[str, Any]:
    matches = [item for item in registry["checks"] if item["gate_id"] == gate_id]
    if len(matches) != 1:
        raise RuntimeError(f"trusted parent gate must resolve exactly once: {gate_id}")
    item = matches[0]
    if item["kind"] != "commit-status" or item["scope"] != "all-pr":
        raise RuntimeError("trusted parent may satisfy only an all-pr commit-status gate")
    if item["rename"]["state"] != "stable":
        raise RuntimeError("trusted parent cannot bypass a dual-publish migration gate")
    return item


def evaluate_from_trusted_parent(
    api: Any,
    repository: str,
    pr_number: int,
    registry: dict[str, Any],
    parent_gate_id: str,
    *,
    now: dt.datetime | None = None,
) -> dict[str, Any]:
    parent = _parent_gate(registry, parent_gate_id)
    pr = api.get(f"repos/{repository}/pulls/{pr_number}")
    if not isinstance(pr, dict) or pr.get("state") != "open":
        raise RuntimeError(f"PR #{pr_number} is missing or not open")
    head = pr.get("head")
    base = pr.get("base")
    sha = head.get("sha") if isinstance(head, dict) else None
    base_ref = base.get("ref") if isinstance(base, dict) else None
    if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-fA-F]{40}", sha):
        raise RuntimeError("Pull Request API response is missing authoritative .head.sha")
    if not isinstance(base_ref, str) or not base_ref:
        raise RuntimeError("Pull Request API response is missing authoritative base.ref")

    ruleset_errors = guard.live_ruleset_errors(
        registry, guard._ruleset(api, repository, registry)
    )

    checks = guard._pages(
        api,
        f"repos/{repository}/commits/{sha}/check-runs?filter=latest&per_page=100",
        "check_runs",
    )
    statuses = guard._pages(
        api,
        f"repos/{repository}/commits/{sha}/statuses?per_page=100",
        None,
    )
    for candidate in checks:
        candidate.setdefault("head_sha", sha)
    for candidate in statuses:
        candidate.setdefault("sha", sha)

    child_registry = copy.deepcopy(registry)
    child_registry["checks"] = [
        item for item in child_registry["checks"] if item["gate_id"] != parent_gate_id
    ]
    contexts = {item["context"] for item in guard.exact_entries(child_registry)}
    cache: dict[int, dict[str, Any]] = {}
    for candidate in checks:
        if candidate.get("name") in contexts:
            guard._enrich(api, repository, candidate, "details_url", cache)
    for candidate in statuses:
        if candidate.get("context") in contexts:
            guard._enrich(api, repository, candidate, "target_url", cache)

    child_exact = guard.exact_head_report(
        child_registry,
        sha,
        checks,
        statuses,
        now=now,
        trusted_base_ref=base_ref,
    )
    parent_projection = {
        "gate_id": parent["gate_id"],
        "source_gate_id": parent["gate_id"],
        "migration_role": "current",
        "context": parent["context"],
        "kind": parent["kind"],
        "workflow": parent["workflow"],
        "decision": "pass",
        "reason": "trusted-parent-satisfied",
    }
    exact_report = {
        **child_exact,
        "gates": [parent_projection, *child_exact["gates"]],
        "trusted_parent_satisfied_gate": parent_gate_id,
    }
    decision = "fail" if ruleset_errors else child_exact["decision"]
    return {
        "schema_version": 1,
        "repository": repository,
        "pr_number": pr_number,
        "authoritative_head_sha": sha,
        "authoritative_base_ref": base_ref,
        "decision": decision,
        "live_ruleset": {
            "decision": "pass" if not ruleset_errors else "fail",
            "errors": ruleset_errors,
        },
        "exact_head": exact_report,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live-pr", type=int, required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--registry", type=Path, required=True)
    parser.add_argument("--parent-gate", required=True)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    try:
        registry = guard.load_required_check_registry(args.registry, args.policy)
        report = evaluate_from_trusted_parent(
            guard.GitHubApi(
                os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN"),
                os.environ.get("GITHUB_API_URL", "https://api.github.com"),
            ),
            args.repository,
            args.live_pr,
            registry,
            args.parent_gate,
        )
    except RuntimeError as exc:
        report = {
            "schema_version": 1,
            "repository": args.repository,
            "pr_number": args.live_pr,
            "decision": "fail",
            "error": str(exc),
        }
    if args.json:
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    else:
        print(f"Trusted-parent required-check evaluation: {report['decision']}")
    return 0 if report["decision"] == "pass" else (2 if report["decision"] == "pending" else 1)


if __name__ == "__main__":
    raise SystemExit(main())
