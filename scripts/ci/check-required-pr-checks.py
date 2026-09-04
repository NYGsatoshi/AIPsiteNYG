#!/usr/bin/env python3
"""Fail closed on required-check topology, live ruleset drift, and exact-head state.

Default mode performs repository-static validation and is safe on an untrusted PR
checkout. ``--live-pr`` is for GOV-02's trusted default-branch evaluator: it
re-fetches the Pull Request API object, treats only ``.head.sha`` as authoritative,
and evaluates live ruleset/check/status evidence without executing PR-head code.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[2]
POLICY_PATH = ROOT / "governance" / "policy.json"
REGISTRY_PATH = ROOT / "governance" / "required-checks.json"
REQUIRED_CHECKS_CONTROL_ID = "GOV-CHECKS-001"
RULESET_CONTROL_ID = "GOV-RULESET-001"
KINDS = {"workflow-job", "commit-status"}
PENDING = {"queued", "in_progress", "pending"}
REJECTED = {
    "failure",
    "timed_out",
    "action_required",
    "cancelled",
    "skipped",
    "neutral",
    "stale",
    "error",
}
RUN_URL = re.compile(r"/actions/runs/(?P<id>[0-9]+)(?:/|$)")


def _json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"unable to load {label}: {exc}") from exc


def _control(policy: dict[str, Any], cid: str, family: str) -> dict[str, Any]:
    controls = policy.get("controls")
    if not isinstance(controls, list):
        raise RuntimeError("governance policy controls must be an array")
    matches = [c for c in controls if isinstance(c, dict) and c.get("id") == cid]
    if len(matches) != 1 or matches[0].get("family") != family:
        raise RuntimeError(f"policy must define exactly one {cid} / {family} control")
    return matches[0]


def _str(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise RuntimeError(f"{label} must be a non-empty string")
    return value


def load_required_status_checks(policy_path: Path = POLICY_PATH) -> tuple[dict[str, Any], ...]:
    """Load the authoritative minimal projection from GOV-CHECKS-001."""
    policy = _json(policy_path, "governance policy")
    if not isinstance(policy, dict):
        raise RuntimeError("governance policy must be an object")
    control = _control(policy, REQUIRED_CHECKS_CONTROL_ID, "required-status-checks")
    expected = control.get("expected")
    required = expected.get("required") if isinstance(expected, dict) else None
    if not isinstance(required, list) or not required:
        raise RuntimeError(f"{REQUIRED_CHECKS_CONTROL_ID}.expected.required must be non-empty")
    result: list[dict[str, Any]] = []
    contexts: set[str] = set()
    for index, item in enumerate(required):
        if not isinstance(item, dict) or set(item) != {"kind", "workflow", "job", "context"}:
            raise RuntimeError(f"{REQUIRED_CHECKS_CONTROL_ID}.expected.required[{index}] is invalid")
        kind = item.get("kind")
        if kind not in KINDS:
            raise RuntimeError(f"required check [{index}] kind is invalid")
        normalized = {
            "kind": kind,
            "workflow": _str(item.get("workflow"), f"required check [{index}].workflow"),
            "job": _str(item.get("job"), f"required check [{index}].job"),
            "context": _str(item.get("context"), f"required check [{index}].context"),
        }
        if normalized["context"] in contexts:
            raise RuntimeError(f"duplicate required context {normalized['context']!r}")
        contexts.add(normalized["context"])
        result.append(normalized)
    return tuple(result)


def _validate_rename(value: Any, label: str) -> None:
    fields = {"state", "previous_context", "previous_workflow", "previous_job", "migration_issue"}
    if not isinstance(value, dict) or set(value) != fields:
        raise RuntimeError(f"{label} fields are invalid")
    if value["state"] not in {"stable", "dual-publish"}:
        raise RuntimeError(f"{label}.state is invalid")
    previous = [value[k] for k in ("previous_context", "previous_workflow", "previous_job")]
    if any(v is not None and (not isinstance(v, str) or not v) for v in previous):
        raise RuntimeError(f"{label} previous identifiers must be null or non-empty strings")
    issue = value["migration_issue"]
    if issue is not None and (not isinstance(issue, int) or isinstance(issue, bool) or issue <= 0):
        raise RuntimeError(f"{label}.migration_issue must be null or positive")
    if value["state"] == "stable" and (any(v is not None for v in previous) or issue is not None):
        raise RuntimeError(f"{label}: stable state cannot retain migration metadata")
    if value["state"] == "dual-publish" and (not any(v is not None for v in previous) or issue is None):
        raise RuntimeError(f"{label}: dual-publish requires previous identifier + migration_issue")


def load_required_check_registry(
    registry_path: Path = REGISTRY_PATH,
    policy_path: Path = POLICY_PATH,
) -> dict[str, Any]:
    """Load the operational registry and prove its required-check projection matches policy."""
    registry = _json(registry_path, "required-check registry")
    top = {"$schema", "version", "policy_control_id", "ruleset", "checks"}
    if not isinstance(registry, dict) or set(registry) != top:
        raise RuntimeError("required-check registry top-level fields are invalid")
    if registry["$schema"] != "./required-checks.schema.json" or registry["version"] != 1:
        raise RuntimeError("required-check registry schema/version is invalid")
    if registry["policy_control_id"] != REQUIRED_CHECKS_CONTROL_ID:
        raise RuntimeError("required-check registry policy_control_id is invalid")
    ruleset = registry["ruleset"]
    if not isinstance(ruleset, dict) or set(ruleset) != {
        "name", "enforcement", "strict_required_status_checks_policy"
    }:
        raise RuntimeError("required-check registry ruleset fields are invalid")
    _str(ruleset.get("name"), "registry ruleset.name")
    if ruleset.get("enforcement") != "active" or ruleset.get("strict_required_status_checks_policy") is not True:
        raise RuntimeError("required-check registry requires active + strict ruleset")

    fields = {
        "gate_id", "kind", "workflow", "job", "context", "scope", "trigger",
        "producer", "ruleset_integration_id", "allowed_conclusions", "timeout_minutes",
        "staleness_policy", "rename",
    }
    checks = registry["checks"]
    if not isinstance(checks, list) or not checks:
        raise RuntimeError("required-check registry checks must be non-empty")
    gate_ids: set[str] = set()
    contexts: set[str] = set()
    projection: list[dict[str, Any]] = []
    for index, item in enumerate(checks):
        label = f"registry checks[{index}]"
        if not isinstance(item, dict) or set(item) != fields:
            raise RuntimeError(f"{label} fields are invalid")
        gate_id = _str(item["gate_id"], f"{label}.gate_id")
        if not re.fullmatch(r"GOV-GATE-[A-Z0-9-]+-[0-9]{3}", gate_id) or gate_id in gate_ids:
            raise RuntimeError(f"{label}.gate_id is invalid or duplicate")
        gate_ids.add(gate_id)
        kind = item["kind"]
        if kind not in KINDS:
            raise RuntimeError(f"{label}.kind is invalid")
        workflow = _str(item["workflow"], f"{label}.workflow")
        job = _str(item["job"], f"{label}.job")
        context = _str(item["context"], f"{label}.context")
        if context in contexts:
            raise RuntimeError(f"duplicate required context {context!r}")
        contexts.add(context)
        if item["scope"] != "all-pr":
            raise RuntimeError(f"{label}.scope must currently be 'all-pr'")
        trigger = item["trigger"]
        producer = item["producer"]
        integration = item["ruleset_integration_id"]
        if kind == "workflow-job":
            if trigger != {"mode": "unfiltered-pull-request", "event": "pull_request"}:
                raise RuntimeError(f"{label}: workflow-job trigger contract is invalid")
            if not isinstance(producer, dict) or set(producer) != {"type", "integration_id", "app_slug"}:
                raise RuntimeError(f"{label}: workflow-job producer fields are invalid")
            if producer.get("type") != "github-actions-check" or producer.get("app_slug") != "github-actions":
                raise RuntimeError(f"{label}: workflow-job producer is invalid")
            producer_id = producer.get("integration_id")
            if not isinstance(producer_id, int) or isinstance(producer_id, bool) or producer_id <= 0:
                raise RuntimeError(f"{label}: producer integration_id is invalid")
            if integration != producer_id:
                raise RuntimeError(f"{label}: ruleset integration must pin producer integration")
        else:
            if not isinstance(trigger, dict) or set(trigger) != {"mode", "event", "source_workflow"}:
                raise RuntimeError(f"{label}: commit-status trigger fields are invalid")
            if trigger.get("mode") != "trusted-workflow-run" or trigger.get("event") != "workflow_run":
                raise RuntimeError(f"{label}: commit-status trigger is invalid")
            _str(trigger.get("source_workflow"), f"{label}.trigger.source_workflow")
            if not isinstance(producer, dict) or set(producer) != {"type", "creator_login", "workflow_path_required"}:
                raise RuntimeError(f"{label}: commit-status producer fields are invalid")
            if producer.get("type") != "github-actions-status" or producer.get("workflow_path_required") is not True:
                raise RuntimeError(f"{label}: commit-status producer is invalid")
            _str(producer.get("creator_login"), f"{label}.producer.creator_login")
            if integration is not None:
                raise RuntimeError(f"{label}: commit-status baseline ruleset integration must be null")
        if item["allowed_conclusions"] != ["success"]:
            raise RuntimeError(f"{label}: only success may pass")
        timeout = item["timeout_minutes"]
        if not isinstance(timeout, int) or isinstance(timeout, bool) or timeout <= 0:
            raise RuntimeError(f"{label}.timeout_minutes is invalid")
        if item["staleness_policy"] != "exact-head-and-timeout":
            raise RuntimeError(f"{label}.staleness_policy is invalid")
        _validate_rename(item["rename"], f"{label}.rename")
        projection.append({"kind": kind, "workflow": workflow, "job": job, "context": context})

    if tuple(projection) != load_required_status_checks(policy_path):
        raise RuntimeError("required-check registry projection must exactly match GOV-CHECKS-001")
    policy = _json(policy_path, "governance policy")
    rule_control = _control(policy, RULESET_CONTROL_ID, "ruleset")
    expected = rule_control.get("expected")
    if not isinstance(expected, dict) or ruleset["name"] not in expected.get("ruleset_names", []):
        raise RuntimeError("registry ruleset is not owned by GOV-RULESET-001")
    if expected.get("strict_required_status_checks") is not True:
        raise RuntimeError("GOV-RULESET-001 must require strict checks")
    return registry


def _without_comment(line: str) -> str:
    quote: str | None = None
    escaped = False
    out: list[str] = []
    for char in line:
        if escaped:
            out.append(char); escaped = False
        elif char == "\\" and quote == '"':
            out.append(char); escaped = True
        elif char in {"'", '"'}:
            quote = None if quote == char else (char if quote is None else quote); out.append(char)
        elif char == "#" and quote is None:
            break
        else:
            out.append(char)
    return "".join(out).rstrip()


def _lines(text: str) -> list[str]:
    return [_without_comment(line) for line in text.splitlines()]


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip())


def has_unfiltered_event(text: str, event: str) -> bool:
    lines = _lines(text)
    token = re.compile(rf"(^|[\s,\[])[\"']?{re.escape(event)}[\"']?(?=$|[\s,\]])")
    for on_i, line in enumerate(lines):
        match = re.match(r"^(?:on|'on'|\"on\")\s*:\s*(.*)$", line)
        if not match:
            continue
        inline = match.group(1).strip()
        if inline:
            return bool(token.search(inline))
        base = _indent(line)
        nested = [i for i in range(on_i + 1, len(lines)) if lines[i].strip()]
        nested = [i for i in nested if _indent(lines[i]) > base]
        if not nested:
            return False
        event_indent = min(_indent(lines[i]) for i in nested)
        pattern = re.compile(rf"^[\"']?{re.escape(event)}[\"']?\s*:\s*(.*)$")
        for i in nested:
            if _indent(lines[i]) != event_indent:
                continue
            event_match = pattern.match(lines[i].strip())
            if not event_match:
                continue
            if event_match.group(1).strip():
                return False
            for child in lines[i + 1 :]:
                if not child.strip():
                    continue
                if _indent(child) <= event_indent:
                    break
                return False
            return True
        return False
    return False


def has_workflow_run_source(text: str, source: str) -> bool:
    lines = _lines(text)
    for i, line in enumerate(lines):
        if not re.match(r"^\s*workflow_run\s*:\s*$", line):
            continue
        base = _indent(line)
        block: list[str] = []
        for child in lines[i + 1 :]:
            if child.strip() and _indent(child) <= base:
                break
            block.append(child)
        joined = "\n".join(block)
        workflow = re.compile(rf"workflows\s*:\s*\[[^\]]*[\"']{re.escape(source)}[\"'][^\]]*\]")
        completed = re.compile(r"types\s*:\s*\[[^\]]*completed[^\]]*\]")
        if workflow.search(joined) and completed.search(joined):
            return True
    return False


def _job_blocks(text: str) -> dict[str, tuple[int, int, int]]:
    lines = _lines(text)
    jobs_i = next((i for i, line in enumerate(lines) if re.match(r"^jobs\s*:\s*$", line)), None)
    if jobs_i is None:
        return {}
    base = _indent(lines[jobs_i])
    nested: list[int] = []
    for i in range(jobs_i + 1, len(lines)):
        if not lines[i].strip():
            continue
        if _indent(lines[i]) <= base:
            break
        nested.append(i)
    if not nested:
        return {}
    job_indent = min(_indent(lines[i]) for i in nested)
    starts: list[tuple[int, str]] = []
    for i in nested:
        if _indent(lines[i]) == job_indent:
            match = re.match(r"^([A-Za-z0-9_.-]+)\s*:\s*$", lines[i].strip())
            if match:
                starts.append((i, match.group(1)))
    result: dict[str, tuple[int, int, int]] = {}
    for n, (start, job) in enumerate(starts):
        result[job] = (start, starts[n + 1][0] if n + 1 < len(starts) else len(lines), job_indent)
    return result


def _job_field(text: str, block: tuple[int, int, int], key: str) -> str | None:
    lines = _lines(text)
    start, end, job_indent = block
    children = [i for i in range(start + 1, end) if lines[i].strip() and _indent(lines[i]) > job_indent]
    if not children:
        return None
    child_indent = min(_indent(lines[i]) for i in children)
    pattern = re.compile(rf"^{re.escape(key)}\s*:\s*(.*)$")
    for i in children:
        if _indent(lines[i]) == child_indent:
            match = pattern.match(lines[i].strip())
            if match:
                return match.group(1).strip()
    return None


def required_check_errors(relative: str, text: str, registry: dict[str, Any] | None = None) -> list[str]:
    registry = registry or load_required_check_registry()
    entries = [c for c in registry["checks"] if c["workflow"] == relative]
    if not entries:
        return []
    errors: list[str] = []
    jobs = _job_blocks(text)
    if any(c["kind"] == "workflow-job" for c in entries) and not has_unfiltered_event(text, "pull_request"):
        errors.append(f"{relative}: required workflow must use an unfiltered pull_request trigger")
    for item in entries:
        job = item["job"]
        block = jobs.get(job)
        if block is None:
            errors.append(f"{relative}: required check job '{job}' is missing")
            continue
        if item["kind"] == "workflow-job":
            if _job_field(text, block, "name") != item["context"]:
                errors.append(f"{relative}: required check job '{job}' must keep name {item['context']!r}")
            if _job_field(text, block, "if") is not None:
                errors.append(f"{relative}: required check job '{job}' must not use job-level if")
            if _job_field(text, block, "needs") is not None:
                errors.append(f"{relative}: required check job '{job}' must not depend on another job")
        if _job_field(text, block, "continue-on-error") is not None:
            errors.append(f"{relative}: required check job '{job}' must not use continue-on-error")
        raw_timeout = _job_field(text, block, "timeout-minutes")
        timeout = int(raw_timeout) if raw_timeout and raw_timeout.isdigit() else None
        if timeout != item["timeout_minutes"]:
            errors.append(f"{relative}: required check job '{job}' timeout-minutes must remain {item['timeout_minutes']}")
    for item in entries:
        if item["kind"] == "commit-status" and not has_workflow_run_source(text, item["trigger"]["source_workflow"]):
            errors.append(
                f"{relative}: trusted commit-status producer must consume completed workflow_run "
                f"from {item['trigger']['source_workflow']!r}"
            )
    return errors


def repository_errors(
    root: Path = ROOT,
    registry_path: Path | None = None,
    policy_path: Path | None = None,
) -> list[str]:
    try:
        registry = load_required_check_registry(
            registry_path or root / "governance" / "required-checks.json",
            policy_path or root / "governance" / "policy.json",
        )
    except RuntimeError as exc:
        return [str(exc)]
    errors: list[str] = []
    for relative in sorted({c["workflow"] for c in registry["checks"]}):
        path = root / relative
        if not path.is_file():
            errors.append(f"{relative}: required workflow is missing")
        else:
            errors += required_check_errors(relative, path.read_text(encoding="utf-8"), registry)
    return errors


def live_ruleset_errors(registry: dict[str, Any], live: Any) -> list[str]:
    if not isinstance(live, dict):
        return ["live ruleset response must be an object"]
    expected_contract = registry["ruleset"]
    errors: list[str] = []
    if live.get("name") != expected_contract["name"]:
        errors.append(f"live ruleset name drift: expected {expected_contract['name']!r}, got {live.get('name')!r}")
    if live.get("enforcement") != "active":
        errors.append(f"live ruleset enforcement drift: expected 'active', got {live.get('enforcement')!r}")
    if live.get("target") != "branch":
        errors.append("live required-check ruleset must target branches")
    conditions = live.get("conditions")
    ref = conditions.get("ref_name") if isinstance(conditions, dict) else None
    includes = ref.get("include") if isinstance(ref, dict) else None
    if not isinstance(includes, list) or "~DEFAULT_BRANCH" not in includes:
        errors.append("live required-check ruleset must include ~DEFAULT_BRANCH")
    rules = live.get("rules")
    if not isinstance(rules, list):
        return errors + ["live ruleset rules must be an array"]
    status_rules = [r for r in rules if isinstance(r, dict) and r.get("type") == "required_status_checks"]
    if len(status_rules) != 1:
        return errors + [f"live ruleset must define exactly one required_status_checks rule; found {len(status_rules)}"]
    params = status_rules[0].get("parameters")
    if not isinstance(params, dict):
        return errors + ["live required_status_checks parameters are missing"]
    if params.get("strict_required_status_checks_policy") is not True:
        errors.append("live strict_required_status_checks_policy must be true")
    raw = params.get("required_status_checks")
    if not isinstance(raw, list):
        return errors + ["live required_status_checks list is missing"]
    actual: list[tuple[str, int | None]] = []
    counts: dict[str, int] = {}
    for i, item in enumerate(raw):
        if not isinstance(item, dict) or not isinstance(item.get("context"), str) or not item["context"]:
            errors.append(f"live required status check at index {i} is malformed")
            continue
        context = item["context"]
        integration = item.get("integration_id")
        if integration is not None and (not isinstance(integration, int) or isinstance(integration, bool) or integration <= 0):
            errors.append(f"live required context {context!r} has invalid integration_id")
            continue
        actual.append((context, integration)); counts[context] = counts.get(context, 0) + 1
    for context, count in sorted(counts.items()):
        if count > 1:
            errors.append(f"live ruleset contains duplicate required context {context!r}")
    expected = [(c["context"], c["ruleset_integration_id"]) for c in registry["checks"] if c["scope"] == "all-pr"]
    actual_set, expected_set = set(actual), set(expected)
    for context, integration in expected:
        if (context, integration) not in actual_set:
            same = [pair[1] for pair in actual if pair[0] == context]
            if same:
                errors.append(f"live required context {context!r} producer integration drift: expected {integration!r}, got {same!r}")
            else:
                errors.append(f"live ruleset is missing required context {context!r}")
    for context, integration in actual:
        if (context, integration) not in expected_set and not any(e[0] == context for e in expected):
            errors.append(f"live ruleset contains unknown required context {context!r} (integration_id={integration!r})")
    return errors


def _time(value: Any) -> dt.datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def _head(candidate: dict[str, Any], sha: str) -> bool:
    value = candidate.get("head_sha", candidate.get("sha"))
    return isinstance(value, str) and value == sha


def _producer_error(item: dict[str, Any], candidate: dict[str, Any], sha: str) -> str | None:
    if not _head(candidate, sha):
        return "non-current-head"
    if candidate.get("workflow") != item["workflow"]:
        return "workflow-producer-drift"
    producer = item["producer"]
    if item["kind"] == "workflow-job":
        if candidate.get("workflow_head_sha") not in {None, sha}:
            return "workflow-run-head-drift"
        app = candidate.get("app")
        if not isinstance(app, dict) or app.get("id") != producer["integration_id"] or app.get("slug") != producer["app_slug"]:
            return "check-app-drift"
        if candidate.get("workflow_event") != "pull_request":
            return "workflow-event-drift"
    else:
        creator = candidate.get("creator")
        if not isinstance(creator, dict) or creator.get("login") != producer["creator_login"]:
            return "status-creator-drift"
        if candidate.get("workflow_event") not in {None, "workflow_run", "workflow_dispatch"}:
            return "trusted-status-event-drift"
    return None


def _state(item: dict[str, Any], candidate: dict[str, Any]) -> str:
    if item["kind"] == "workflow-job":
        status = candidate.get("status")
        if status in PENDING:
            return str(status)
        if status != "completed":
            return str(status or "unknown")
        return str(candidate.get("conclusion") or "unknown")
    return str(candidate.get("state") or "unknown")


def _sort_time(candidate: dict[str, Any]) -> dt.datetime:
    for key in ("completed_at", "updated_at", "started_at", "created_at"):
        parsed = _time(candidate.get(key))
        if parsed:
            return parsed
    return dt.datetime.min.replace(tzinfo=dt.timezone.utc)


def exact_head_report(
    registry: dict[str, Any],
    head_sha: str,
    check_runs: Iterable[dict[str, Any]],
    statuses: Iterable[dict[str, Any]],
    *,
    now: dt.datetime | None = None,
) -> dict[str, Any]:
    """Evaluate only evidence bound to the authoritative current PR head."""
    if not isinstance(head_sha, str) or not re.fullmatch(r"[0-9a-fA-F]{40}", head_sha):
        raise RuntimeError("authoritative PR head SHA must be a 40-character hexadecimal SHA")
    current = now or dt.datetime.now(dt.timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=dt.timezone.utc)
    current = current.astimezone(dt.timezone.utc)
    runs = [c for c in check_runs if isinstance(c, dict)]
    status_list = [c for c in statuses if isinstance(c, dict)]
    gates: list[dict[str, Any]] = []
    overall = "pass"
    for item in registry["checks"]:
        candidates = (
            [c for c in runs if c.get("name") == item["context"]]
            if item["kind"] == "workflow-job"
            else [c for c in status_list if c.get("context") == item["context"]]
        )
        current_candidates = [c for c in candidates if _head(c, head_sha)]
        valid, producer_errors = [], []
        for candidate in current_candidates:
            error = _producer_error(item, candidate, head_sha)
            (valid if error is None else producer_errors).append(candidate if error is None else error)
        gate: dict[str, Any] = {
            "gate_id": item["gate_id"], "context": item["context"], "kind": item["kind"],
            "decision": "fail", "reason": "missing-current-head",
        }
        if not valid:
            if current_candidates and producer_errors:
                gate.update(reason="producer-drift", producer_errors=sorted(set(producer_errors)))
            elif candidates:
                gate["reason"] = "previous-head-only"
            overall = "fail"; gates.append(gate); continue
        valid.sort(key=lambda c: (_sort_time(c), int(c.get("id", 0)) if str(c.get("id", "")).isdigit() else 0), reverse=True)
        selected = valid[0]
        state = _state(item, selected); gate["observed_state"] = state
        if state == "success":
            gate.update(decision="pass", reason="accepted-success")
        elif state in PENDING:
            started = _time(selected.get("started_at")) or _time(selected.get("created_at"))
            timed_out = started is None or current - started > dt.timedelta(minutes=item["timeout_minutes"])
            if timed_out:
                gate["reason"] = "pending-timeout"; overall = "fail"
            else:
                gate.update(decision="pending", reason="current-head-pending")
                if overall == "pass": overall = "pending"
        elif state in REJECTED:
            gate["reason"] = "rejected-conclusion"; overall = "fail"
        else:
            gate["reason"] = "unknown-conclusion"; overall = "fail"
        gates.append(gate)
    return {"schema_version": 1, "authoritative_head_sha": head_sha, "decision": overall, "gates": gates}


class GitHubApi:
    def __init__(self, token: str | None = None, api_url: str = "https://api.github.com") -> None:
        self.token, self.api_url = token, api_url.rstrip("/")

    def get(self, path: str) -> Any:
        url = path if path.startswith("https://") else f"{self.api_url}/{path.lstrip('/')}"
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "AIPsiteNYG-required-check-evaluator",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        request = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                raw = response.read().decode("utf-8")
        except (urllib.error.URLError, TimeoutError, UnicodeDecodeError) as exc:
            raise RuntimeError(f"GitHub API GET failed for {url}: {exc}") from exc
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"GitHub API returned malformed JSON for {url}: {exc}") from exc


def _run_id(url: Any) -> int | None:
    match = RUN_URL.search(url) if isinstance(url, str) else None
    return int(match.group("id")) if match else None


def _enrich(api: Any, repository: str, candidate: dict[str, Any], url_key: str, cache: dict[int, dict[str, Any]]) -> None:
    run_id = _run_id(candidate.get(url_key))
    if run_id is None:
        return
    if run_id not in cache:
        run = api.get(f"repos/{repository}/actions/runs/{run_id}")
        if not isinstance(run, dict):
            raise RuntimeError(f"GitHub Actions run {run_id} response must be an object")
        cache[run_id] = run
    run = cache[run_id]
    candidate["workflow"] = run.get("path")
    candidate["workflow_event"] = run.get("event")
    candidate["workflow_head_sha"] = run.get("head_sha")


def _fetch_ruleset(api: Any, repository: str, registry: dict[str, Any]) -> dict[str, Any]:
    summaries = api.get(f"repos/{repository}/rulesets")
    if not isinstance(summaries, list):
        raise RuntimeError("GitHub ruleset list response must be an array")
    name = registry["ruleset"]["name"]
    matches = [r for r in summaries if isinstance(r, dict) and r.get("name") == name]
    if len(matches) != 1 or not isinstance(matches[0].get("id"), int):
        raise RuntimeError(f"expected exactly one live ruleset named {name!r}")
    live = api.get(f"repos/{repository}/rulesets/{matches[0]['id']}")
    if not isinstance(live, dict):
        raise RuntimeError("GitHub ruleset detail response must be an object")
    return live


def evaluate_live_pr(
    api: Any,
    repository: str,
    pr_number: int,
    registry: dict[str, Any],
    *,
    now: dt.datetime | None = None,
) -> dict[str, Any]:
    """Re-fetch authoritative PR/head and evaluate live ruleset + exact-head evidence."""
    pr = api.get(f"repos/{repository}/pulls/{pr_number}")
    if not isinstance(pr, dict) or pr.get("state") != "open":
        raise RuntimeError(f"PR #{pr_number} is missing or not open")
    head = pr.get("head"); sha = head.get("sha") if isinstance(head, dict) else None
    if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-fA-F]{40}", sha):
        raise RuntimeError("Pull Request API response is missing authoritative .head.sha")
    ruleset_errors = live_ruleset_errors(registry, _fetch_ruleset(api, repository, registry))
    checks_payload = api.get(f"repos/{repository}/commits/{sha}/check-runs?filter=latest&per_page=100")
    statuses_payload = api.get(f"repos/{repository}/commits/{sha}/statuses?per_page=100")
    if not isinstance(checks_payload, dict) or not isinstance(checks_payload.get("check_runs"), list):
        raise RuntimeError("GitHub check-runs response is malformed")
    if not isinstance(statuses_payload, list):
        raise RuntimeError("GitHub commit-status response is malformed")
    checks = [dict(c) for c in checks_payload["check_runs"] if isinstance(c, dict)]
    statuses = [dict(c) for c in statuses_payload if isinstance(c, dict)]
    for candidate in checks: candidate.setdefault("head_sha", sha)
    for candidate in statuses: candidate.setdefault("sha", sha)
    contexts = {c["context"] for c in registry["checks"]}; cache: dict[int, dict[str, Any]] = {}
    for candidate in checks:
        if candidate.get("name") in contexts: _enrich(api, repository, candidate, "details_url", cache)
    for candidate in statuses:
        if candidate.get("context") in contexts: _enrich(api, repository, candidate, "target_url", cache)
    exact = exact_head_report(registry, sha, checks, statuses, now=now)
    decision = "fail" if ruleset_errors else exact["decision"]
    return {
        "schema_version": 1,
        "repository": repository,
        "pr_number": pr_number,
        "authoritative_head_sha": sha,
        "decision": decision,
        "live_ruleset": {"decision": "pass" if not ruleset_errors else "fail", "errors": ruleset_errors},
        "exact_head": exact,
    }


def _exit(decision: str) -> int:
    return 0 if decision == "pass" else (2 if decision == "pending" else 1)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live-pr", type=int, help="trusted mode: evaluate this PR from GitHub API")
    parser.add_argument("--repository", help="owner/repo; defaults to governance policy repository")
    parser.add_argument("--json", action="store_true", help="emit machine-readable live report")
    args = parser.parse_args(argv)
    errors = repository_errors()
    try:
        registry = load_required_check_registry()
    except RuntimeError as exc:
        registry = None
        if str(exc) not in errors: errors.append(str(exc))
    if errors:
        print("Required PR check policy failed:", file=sys.stderr)
        for error in sorted(set(errors)): print(f"- {error}", file=sys.stderr)
        return 1
    assert registry is not None
    if args.live_pr is None:
        print(
            "Required PR check policy passed: "
            f"{len(registry['checks'])} required gates have stable topology, producer identity, "
            "and exact-head contracts."
        )
        return 0
    if args.live_pr <= 0:
        print("--live-pr must be positive", file=sys.stderr); return 1
    policy = _json(POLICY_PATH, "governance policy")
    repository = args.repository or (policy.get("repository") if isinstance(policy, dict) else None)
    if not isinstance(repository, str) or not re.fullmatch(r"[^/\s]+/[^/\s]+", repository):
        print("live repository must be owner/name", file=sys.stderr); return 1
    api = GitHubApi(os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN"), os.environ.get("GITHUB_API_URL", "https://api.github.com"))
    try:
        report = evaluate_live_pr(api, repository, args.live_pr, registry)
    except RuntimeError as exc:
        report = {"schema_version": 1, "repository": repository, "pr_number": args.live_pr, "decision": "fail", "error": str(exc)}
    if args.json:
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    else:
        print(f"Required-check live evaluation: decision={report['decision']} pr={args.live_pr} head={report.get('authoritative_head_sha', 'unknown')}")
        if report.get("error"): print(f"- {report['error']}", file=sys.stderr)
        for error in report.get("live_ruleset", {}).get("errors", []): print(f"- {error}", file=sys.stderr)
        for gate in report.get("exact_head", {}).get("gates", []):
            if gate.get("decision") != "pass": print(f"- {gate.get('context')}: {gate.get('decision')} ({gate.get('reason')})", file=sys.stderr)
    return _exit(str(report.get("decision", "fail")))


if __name__ == "__main__":
    raise SystemExit(main())
