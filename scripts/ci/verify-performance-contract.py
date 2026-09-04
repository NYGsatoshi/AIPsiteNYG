#!/usr/bin/env python3
"""Fail-closed validation for the PERF-01 versioned performance contract."""

from __future__ import annotations

import json
import math
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any

ALLOWED_GATES = {"hard-ceiling", "relative-regression", "trend-only", "extended-only"}
ALLOWED_METRICS = {
    "api.latency.p50_ms": "ms",
    "api.latency.p95_ms": "ms",
    "api.latency.p99_ms": "ms",
    "api.error_rate": "ratio",
    "api.throughput_rps": "rps",
    "db.query_count": "count",
    "db.total_time_ms": "ms",
    "db.slow_query_evidence": "evidence",
    "browser.navigation_ms": "ms",
    "browser.load_ms": "ms",
    "browser.interaction_ms": "ms",
    "build.initial_bundle_size": "MB",
    "build.chunk_size": "MB",
    "runtime.rss_bytes": "bytes",
    "runtime.heap_bytes": "bytes",
    "runtime.gc_pause_ms": "ms",
    "runtime.cpu_percent": "percent",
    "runtime.db_connections": "count",
    "realtime.connect_ms": "ms",
    "realtime.delivery.p95_ms": "ms",
    "realtime.reconnect.p95_ms": "ms",
    "realtime.error_rate": "ratio",
    "realtime.messages_per_second": "messages_per_second",
}
API_METRICS = {
    "api.latency.p50_ms",
    "api.latency.p95_ms",
    "api.latency.p99_ms",
    "api.error_rate",
    "api.throughput_rps",
}
BROWSER_METRICS = {"browser.navigation_ms", "browser.load_ms", "browser.interaction_ms"}
REALTIME_METRICS = {
    "realtime.connect_ms",
    "realtime.delivery.p95_ms",
    "realtime.reconnect.p95_ms",
    "realtime.error_rate",
    "realtime.messages_per_second",
}
PROFILE_NAMES = {"small", "medium", "large"}
PAGINATION_DEFAULTS = {
    "projectList": 50,
    "taskList": 50,
    "myTasks": 50,
    "files": 20,
    "conversations": 20,
    "messages": 50,
    "notifications": 20,
    "announcements": 20,
}
FOCUS_KEYS = {
    "projectList": "workspaceProjects",
    "taskList": "projectTasks",
    "myTasks": "userMyTasks",
    "files": "workspaceFiles",
    "conversations": "conversations",
    "messages": "conversationMessages",
    "notifications": "userNotifications",
    "announcements": "visibleAnnouncements",
}
COUNT_KEYS = {
    "tenants",
    "workspaces",
    "projects",
    "tasks",
    "workItems",
    "milestones",
    "dependencies",
    "members",
    "messages",
    "notifications",
    "announcements",
    "files",
}
SHA_RE = re.compile(r"^[0-9a-f]{40}$")


class ContractError(ValueError):
    pass


def fail(message: str) -> None:
    raise ContractError(message)


def _reject_constant(value: str) -> None:
    fail(f"non-standard numeric constant is forbidden: {value}")


def load_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        fail(f"missing required contract file: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"), parse_constant=_reject_constant)
    except ContractError:
        raise
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"invalid JSON in {path}: {exc}")
    if not isinstance(data, dict):
        fail(f"contract root must be an object: {path}")
    return data


def require_schema(document: dict[str, Any], name: str) -> None:
    if document.get("schemaVersion") != 1:
        fail(f"{name}.schemaVersion must be 1")


def require_sha(value: Any, field: str) -> str:
    if not isinstance(value, str) or not SHA_RE.fullmatch(value):
        fail(f"{field} must be a full lowercase 40-character commit SHA")
    return value


def require_date(value: Any, field: str) -> str:
    if not isinstance(value, str):
        fail(f"{field} must be an ISO date")
    try:
        date.fromisoformat(value)
    except ValueError:
        fail(f"{field} must be an ISO date")
    return value


def require_nonempty(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        fail(f"{field} must be non-empty")
    return value.strip()


def validate_scenarios(document: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], set[tuple[str, str]]]:
    require_schema(document, "scenarios")
    baseline = document.get("inventoryBaseline")
    if not isinstance(baseline, dict):
        fail("scenarios.inventoryBaseline is required")
    require_nonempty(baseline.get("repository"), "scenarios.inventoryBaseline.repository")
    require_sha(baseline.get("sha"), "scenarios.inventoryBaseline.sha")
    require_date(baseline.get("capturedOn"), "scenarios.inventoryBaseline.capturedOn")

    entries = document.get("scenarios")
    if not isinstance(entries, list) or not entries:
        fail("scenarios.scenarios must be a non-empty array")

    by_id: dict[str, dict[str, Any]] = {}
    blocking_metrics: set[tuple[str, str]] = set()
    mutation_count = 0
    realtime_count = 0

    for index, scenario in enumerate(entries):
        if not isinstance(scenario, dict):
            fail(f"scenario[{index}] must be an object")
        scenario_id = require_nonempty(scenario.get("id"), f"scenario[{index}].id")
        if scenario_id in by_id:
            fail(f"duplicate scenario id: {scenario_id}")
        by_id[scenario_id] = scenario
        require_nonempty(scenario.get("ownerSurface"), f"{scenario_id}.ownerSurface")

        issues = scenario.get("relatedIssues")
        if not isinstance(issues, list) or any(not isinstance(issue, int) or issue <= 0 for issue in issues):
            fail(f"{scenario_id}.relatedIssues must be an array of positive issue numbers")

        profiles = scenario.get("datasetProfiles")
        if not isinstance(profiles, list) or not profiles or not set(profiles).issubset(PROFILE_NAMES):
            fail(f"{scenario_id}.datasetProfiles contains an unknown profile")

        surfaces = scenario.get("surfaces")
        if not isinstance(surfaces, list) or not surfaces:
            fail(f"{scenario_id}.surfaces must be non-empty")
        surface_kinds: set[str] = set()
        for surface in surfaces:
            if not isinstance(surface, dict):
                fail(f"{scenario_id}.surfaces entries must be objects")
            kind = surface.get("kind")
            if kind not in {"api", "browser", "realtime"}:
                fail(f"{scenario_id} has unknown surface kind: {kind}")
            surface_kinds.add(kind)
            require_nonempty(surface.get("evidence"), f"{scenario_id}.{kind}.evidence")
            if kind == "api":
                if surface.get("method") not in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
                    fail(f"{scenario_id} has invalid API method")
                path = require_nonempty(surface.get("path"), f"{scenario_id}.api.path")
                if not path.startswith("/api/"):
                    fail(f"{scenario_id} API path must start with /api/")
            elif kind == "browser":
                route = require_nonempty(surface.get("route"), f"{scenario_id}.browser.route")
                if not route.startswith("/"):
                    fail(f"{scenario_id} browser route must start with /")
            else:
                path = require_nonempty(surface.get("path"), f"{scenario_id}.realtime.path")
                if not path.startswith("/hubs/"):
                    fail(f"{scenario_id} realtime path must start with /hubs/")

        metrics = scenario.get("metrics")
        if not isinstance(metrics, list) or not metrics:
            fail(f"{scenario_id}.metrics must be non-empty")
        metric_names: set[str] = set()
        for metric in metrics:
            if not isinstance(metric, dict):
                fail(f"{scenario_id}.metrics entries must be objects")
            name = metric.get("name")
            gate = metric.get("gate")
            if name not in ALLOWED_METRICS:
                fail(f"unknown metric in {scenario_id}: {name}")
            if gate not in ALLOWED_GATES:
                fail(f"unknown gate class in {scenario_id}: {gate}")
            if name in metric_names:
                fail(f"duplicate metric in {scenario_id}: {name}")
            metric_names.add(name)
            if gate in {"hard-ceiling", "relative-regression"}:
                blocking_metrics.add((scenario_id, name))

        if "api" in surface_kinds and not API_METRICS.issubset(metric_names):
            missing = sorted(API_METRICS - metric_names)
            fail(f"{scenario_id} is missing required API metrics: {missing}")
        if "browser" in surface_kinds and not BROWSER_METRICS.issubset(metric_names):
            missing = sorted(BROWSER_METRICS - metric_names)
            fail(f"{scenario_id} is missing required browser metrics: {missing}")
        if "realtime" in surface_kinds:
            realtime_count += 1
            if "api" in surface_kinds:
                fail(f"{scenario_id} must keep realtime as a separate metric family")
            if not REALTIME_METRICS.issubset(metric_names):
                missing = sorted(REALTIME_METRICS - metric_names)
                fail(f"{scenario_id} is missing required realtime metrics: {missing}")

        if scenario_id.startswith("mutation."):
            mutation_count += 1
            reset = scenario.get("mutationReset")
            if not isinstance(reset, dict) or reset.get("mode") != "reseed-profile" or reset.get("failIfUnavailable") is not True:
                fail(f"{scenario_id} must define a fail-closed deterministic reseed reset")
            require_nonempty(reset.get("scope"), f"{scenario_id}.mutationReset.scope")

    if mutation_count < 1:
        fail("at least one deterministic resettable mutation scenario is required")
    if realtime_count != 1:
        fail("exactly one separate realtime.app-hub scenario is required")

    gantt = by_id.get("project.gantt-load")
    if gantt is None:
        fail("project.gantt-load scenario is required")
    contract = gantt.get("ganttContract")
    if not isinstance(contract, dict):
        fail("project.gantt-load.ganttContract is required")
    if contract.get("canonicalIssue") != 270 or contract.get("cursorPagination") is not True:
        fail("Gantt contract must identify #270 cursor pagination")
    if contract.get("defaultPageSize") != 100 or contract.get("maximumPageSize") != 200:
        fail("Gantt contract must preserve #270 default/max page sizes 100/200")
    if contract.get("virtualScrolling") is not True or contract.get("boundedClientCache") is not True:
        fail("Gantt contract must preserve #270 virtualization and bounded cache")
    if contract.get("projectWideHardLimit") is not None:
        fail("Gantt must not invent a Project-wide hard limit that #270 did not approve")
    observed = contract.get("observedMain")
    if not isinstance(observed, dict):
        fail("Gantt observedMain mismatch inventory is required")
    require_sha(observed.get("sha"), "project.gantt-load.ganttContract.observedMain.sha")
    if observed.get("status") != "implementation-mismatch":
        fail("current Gantt source mismatch must remain explicit until reconciled")
    old_limits = observed.get("temporaryFullSnapshotLimitsObserved")
    if not isinstance(old_limits, dict) or old_limits.get("combinedItems") != 500 or old_limits.get("dependencies") != 2000:
        fail("observed historical Gantt limits must be inventory evidence 500/2000")
    if observed.get("limitsAreCanonicalDatasetLimits") is not False:
        fail("temporary Gantt full-snapshot limits must never become dataset limits")

    return by_id, blocking_metrics


def validate_datasets(document: dict[str, Any]) -> None:
    require_schema(document, "datasets")
    if document.get("seedManifestVersion") != 1:
        fail("datasets.seedManifestVersion must be 1")

    contract = document.get("contract")
    if not isinstance(contract, dict):
        fail("datasets.contract is required")
    gantt_contract = contract.get("gantt")
    if not isinstance(gantt_contract, dict):
        fail("datasets.contract.gantt is required")
    if gantt_contract.get("canonicalIssue") != 270 or gantt_contract.get("cursorPagination") is not True:
        fail("datasets must bind Gantt to #270 cursor pagination")
    if gantt_contract.get("defaultPageSize") != 100 or gantt_contract.get("maximumPageSize") != 200:
        fail("datasets must preserve Gantt default/max page sizes 100/200")
    if gantt_contract.get("projectWideHardLimit") is not None:
        fail("datasets must not invent a Gantt Project-wide hard limit")
    if gantt_contract.get("temporaryFullSnapshotLimitsAreDatasetLimits") is not False:
        fail("datasets must not adopt temporary 500/2000 Gantt limits")

    defaults = contract.get("currentListDefaults")
    if not isinstance(defaults, dict):
        fail("datasets.contract.currentListDefaults is required")
    for name, page_size in PAGINATION_DEFAULTS.items():
        if defaults.get(name) != page_size:
            fail(f"dataset default for {name} must match current source: {page_size}")
    if defaults.get("kanbanMaxCards") != 300:
        fail("Kanban default MaxCards must remain 300")

    profiles = document.get("profiles")
    if not isinstance(profiles, dict) or set(profiles) != PROFILE_NAMES:
        fail("datasets.profiles must contain exactly small, medium, and large")

    seeds: set[int] = set()
    for profile_name in sorted(PROFILE_NAMES):
        profile = profiles[profile_name]
        if not isinstance(profile, dict):
            fail(f"dataset profile {profile_name} must be an object")
        seed = profile.get("seed")
        if not isinstance(seed, int) or seed <= 0 or seed in seeds:
            fail(f"dataset profile {profile_name} needs a unique positive deterministic seed")
        seeds.add(seed)

        counts = profile.get("counts")
        if not isinstance(counts, dict) or set(counts) != COUNT_KEYS:
            fail(f"dataset profile {profile_name} must declare all required counts")
        if any(not isinstance(value, int) or value < 0 for value in counts.values()):
            fail(f"dataset profile {profile_name} counts must be non-negative integers")
        if counts["tenants"] < 1 or counts["workspaces"] < 1 or counts["projects"] < 1:
            fail(f"dataset profile {profile_name} requires at least one tenant/workspace/project")
        if counts["workItems"] != counts["tasks"]:
            fail(f"dataset profile {profile_name} must explicitly map Task-kind WorkItems to tasks")

        focus = profile.get("focus")
        if not isinstance(focus, dict):
            fail(f"dataset profile {profile_name}.focus is required")
        required_focus = set(FOCUS_KEYS.values()) | {"projectMilestones", "projectDependencies", "kanbanAuthorizedCards"}
        if not required_focus.issubset(focus):
            fail(f"dataset profile {profile_name} is missing focus cardinalities")
        if any(not isinstance(focus[key], int) or focus[key] < 0 for key in required_focus):
            fail(f"dataset profile {profile_name} focus cardinalities must be non-negative integers")
        if focus["workspaceProjects"] > counts["projects"] or focus["projectTasks"] > counts["tasks"]:
            fail(f"dataset profile {profile_name} focus cardinality exceeds global count")
        if focus["projectMilestones"] > counts["milestones"] or focus["projectDependencies"] > counts["dependencies"]:
            fail(f"dataset profile {profile_name} Gantt focus cardinality exceeds global count")
        if focus["workspaceFiles"] > counts["files"] or focus["conversationMessages"] > counts["messages"]:
            fail(f"dataset profile {profile_name} file/message focus cardinality exceeds global count")
        if focus["userNotifications"] > counts["notifications"] or focus["visibleAnnouncements"] > counts["announcements"]:
            fail(f"dataset profile {profile_name} notification/announcement focus cardinality exceeds global count")

        pagination = profile.get("expectedPagination")
        if not isinstance(pagination, dict) or set(pagination) != set(PAGINATION_DEFAULTS):
            fail(f"dataset profile {profile_name} expectedPagination must cover all bounded list families")
        for name, expected_default in PAGINATION_DEFAULTS.items():
            entry = pagination[name]
            if not isinstance(entry, dict):
                fail(f"{profile_name}.{name} pagination entry must be an object")
            if entry.get("pageSize") != expected_default:
                fail(f"{profile_name}.{name}.pageSize must be {expected_default}")
            expected_cardinality = focus[FOCUS_KEYS[name]]
            if entry.get("cardinality") != expected_cardinality:
                fail(f"{profile_name}.{name}.cardinality must match focus manifest")
            expected_pages = math.ceil(expected_cardinality / expected_default) if expected_cardinality else 0
            if entry.get("pages") != expected_pages:
                fail(f"{profile_name}.{name}.pages must be {expected_pages}")

        kanban = profile.get("kanban")
        if not isinstance(kanban, dict):
            fail(f"dataset profile {profile_name}.kanban is required")
        if kanban.get("maximumSupportedMaxCards") != 500:
            fail(f"{profile_name}.kanban maximum must match current source (500)")
        requested_cards = kanban.get("requestedMaxCards")
        expected_cards = kanban.get("expectedAuthorizedCards")
        if not isinstance(requested_cards, int) or not 1 <= requested_cards <= 500:
            fail(f"{profile_name}.kanban.requestedMaxCards must be within 1..500")
        if expected_cards != focus["kanbanAuthorizedCards"] or expected_cards > requested_cards:
            fail(f"{profile_name}.kanban expected card count must fit the requested bound")

        gantt = profile.get("gantt")
        if not isinstance(gantt, dict):
            fail(f"dataset profile {profile_name}.gantt is required")
        requested_page_size = gantt.get("requestedPageSize")
        if not isinstance(requested_page_size, int) or not 1 <= requested_page_size <= 200:
            fail(f"{profile_name}.gantt requested page size exceeds #270 maximum 200")
        if gantt.get("maximumPageSize") != 200:
            fail(f"{profile_name}.gantt maximum page size must be 200")
        expected_items = focus["projectTasks"] + focus["projectMilestones"]
        if gantt.get("totalItems") != expected_items:
            fail(f"{profile_name}.gantt.totalItems must equal focused tasks + milestones")
        if gantt.get("dependencies") != focus["projectDependencies"]:
            fail(f"{profile_name}.gantt.dependencies must match focused dependencies")
        expected_pages = math.ceil(expected_items / requested_page_size) if expected_items else 0
        if gantt.get("expectedPages") != expected_pages:
            fail(f"{profile_name}.gantt.expectedPages must be {expected_pages}")

    large = profiles["large"]
    if large["gantt"]["totalItems"] <= 500 or large["gantt"]["dependencies"] <= 2000:
        fail("large Gantt profile must not be silently collapsed into historical PR06 500/2000 limits")
    if large["gantt"]["expectedPages"] <= 1:
        fail("large Gantt profile must exercise multi-page delivery")


def validate_budgets(
    document: dict[str, Any],
    scenarios: dict[str, dict[str, Any]],
    blocking_metrics: set[tuple[str, str]],
) -> None:
    require_schema(document, "budgets")
    policy = document.get("policy")
    if not isinstance(policy, dict):
        fail("budgets.policy is required")
    required_policy = {
        "timeout": "fail",
        "missingSample": "fail",
        "allowInfinity": False,
        "allowEffectivelyDisabledThresholds": False,
        "allowAverageOnlyLatencyGate": False,
        "githubHostedRunnerTinyDeltaBlocking": False,
    }
    for key, value in required_policy.items():
        if policy.get(key) != value:
            fail(f"budgets.policy.{key} must be {value!r}")
    if policy.get("budgetRelaxationRequires") != ["reason", "beforeEvidence", "afterEvidence"]:
        fail("budget relaxation policy must require reason/beforeEvidence/afterEvidence")

    budgets = document.get("budgets")
    if not isinstance(budgets, list):
        fail("budgets.budgets must be an array")
    covered: set[tuple[str, str]] = set()
    budget_ids: set[str] = set()

    for index, budget in enumerate(budgets):
        if not isinstance(budget, dict):
            fail(f"budget[{index}] must be an object")
        budget_id = require_nonempty(budget.get("id"), f"budget[{index}].id")
        if budget_id in budget_ids:
            fail(f"duplicate budget id: {budget_id}")
        budget_ids.add(budget_id)
        scenario_id = require_nonempty(budget.get("scenarioId"), f"{budget_id}.scenarioId")
        metric = require_nonempty(budget.get("metric"), f"{budget_id}.metric")
        gate = budget.get("gate")
        if scenario_id not in scenarios:
            fail(f"{budget_id} references unknown scenario: {scenario_id}")
        if metric not in ALLOWED_METRICS:
            fail(f"{budget_id} references unknown metric: {metric}")
        scenario_metric = next((m for m in scenarios[scenario_id]["metrics"] if m["name"] == metric), None)
        if scenario_metric is None:
            fail(f"{budget_id} metric is not declared by scenario {scenario_id}")
        if gate not in {"hard-ceiling", "relative-regression"} or scenario_metric["gate"] != gate:
            fail(f"{budget_id} gate must match the scenario blocking gate")
        key = (scenario_id, metric)
        if key in covered:
            fail(f"multiple budgets cover blocking metric: {scenario_id}/{metric}")
        covered.add(key)

        rationale = require_nonempty(budget.get("rationale"), f"{budget_id}.rationale")
        if len(rationale) < 20:
            fail(f"{budget_id}.rationale is too short to be reviewable")

        baseline = budget.get("baseline")
        if not isinstance(baseline, dict):
            fail(f"{budget_id}.baseline is required")
        require_nonempty(baseline.get("identity"), f"{budget_id}.baseline.identity")
        require_sha(baseline.get("sha"), f"{budget_id}.baseline.sha")
        require_date(baseline.get("date"), f"{budget_id}.baseline.date")
        require_nonempty(baseline.get("sourceKind"), f"{budget_id}.baseline.sourceKind")
        evidence = baseline.get("evidence")
        if not isinstance(evidence, list) or not evidence or any(not isinstance(item, str) or not item.strip() for item in evidence):
            fail(f"{budget_id}.baseline.evidence must be non-empty")

        if gate == "hard-ceiling":
            limit = budget.get("limit")
            if not isinstance(limit, dict):
                fail(f"{budget_id}.limit is required for hard-ceiling")
            value = limit.get("value")
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or value <= 0:
                fail(f"{budget_id}.limit.value must be a finite positive number")
            if limit.get("unit") != ALLOWED_METRICS[metric]:
                fail(f"{budget_id}.limit.unit must be {ALLOWED_METRICS[metric]}")
        else:
            comparison = budget.get("comparison")
            if not isinstance(comparison, dict):
                fail(f"{budget_id}.comparison is required for relative-regression")
            increase = comparison.get("maxIncreasePercent")
            if not isinstance(increase, (int, float)) or isinstance(increase, bool) or not math.isfinite(increase) or increase <= 0:
                fail(f"{budget_id}.comparison.maxIncreasePercent must be finite and positive")
            require_nonempty(baseline.get("identity"), f"{budget_id}.baseline.identity")

    if covered != blocking_metrics:
        missing = sorted(blocking_metrics - covered)
        extra = sorted(covered - blocking_metrics)
        fail(f"blocking budget coverage mismatch; missing={missing}, extra={extra}")

    relative = document.get("relativeRegressionBaselines")
    if not isinstance(relative, list):
        fail("budgets.relativeRegressionBaselines must be an array")


def validate_contract(root: Path) -> dict[str, Any]:
    scenarios_doc = load_json(root / "performance" / "scenarios.json")
    datasets_doc = load_json(root / "performance" / "datasets.json")
    budgets_doc = load_json(root / "performance" / "budgets.json")
    scenarios, blocking_metrics = validate_scenarios(scenarios_doc)
    validate_datasets(datasets_doc)
    validate_budgets(budgets_doc, scenarios, blocking_metrics)
    summary = {
        "blockingBudgets": len(budgets_doc["budgets"]),
        "profiles": sorted(datasets_doc["profiles"].keys()),
        "scenarioIds": sorted(scenarios.keys()),
        "schemaVersion": 1,
    }
    return summary


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    try:
        summary = validate_contract(root)
    except ContractError as exc:
        print(f"PERF-01 contract invalid: {exc}", file=sys.stderr)
        return 1
    print("PERF-01 contract valid: " + json.dumps(summary, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
