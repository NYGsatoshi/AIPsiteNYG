#!/usr/bin/env python3
"""Reduce SEC-06 ZAP output to reproducible, secret-free blocking evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from collections import Counter
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlsplit, urlunsplit

RISK_FROM_CODE = {
    "0": "Informational",
    "1": "Low",
    "2": "Medium",
    "3": "High",
}
RISK_ORDER = ("High", "Medium", "Low", "Informational")


def fail(message: str) -> None:
    raise SystemExit(f"SEC-06 ZAP report rejected: {message}")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_text(value: Any, limit: int = 180) -> str:
    text = str(value or "")
    text = re.sub(r"[\x00-\x1f\x7f]+", " ", text).strip()
    return text[:limit]


def normalize_origin(raw: str) -> str:
    try:
        parsed = urlsplit(raw)
        port = parsed.port
    except ValueError as exc:
        fail(f"invalid origin {raw!r}: {exc}")
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        fail(f"invalid HTTP(S) origin {raw!r}")
    if parsed.username is not None or parsed.password is not None:
        fail("origin userinfo is forbidden")
    host = parsed.hostname.rstrip(".").lower()
    display_host = f"[{host}]" if ":" in host else host
    default_port = (parsed.scheme == "http" and port in {None, 80}) or (
        parsed.scheme == "https" and port in {None, 443}
    )
    netloc = display_host if default_port else f"{display_host}:{port}"
    return urlunsplit((parsed.scheme.lower(), netloc, "", "", ""))


def safe_location(raw: Any, target_origin: str) -> dict[str, Any] | None:
    if not raw:
        return None
    value = str(raw)
    parsed = urlsplit(value)
    if not parsed.scheme or not parsed.netloc:
        fail("alert instance URI must be absolute")
    if normalize_origin(value) != target_origin:
        fail(f"cross-origin alert evidence observed: {normalize_origin(value)!r}")
    query_names = sorted(
        {key[:80] for key, _ in parse_qsl(parsed.query, keep_blank_values=True) if key}
    )
    return {
        "path": parsed.path or "/",
        "queryParameterNames": query_names,
    }


def normalize_risk(alert: dict[str, Any]) -> str | None:
    riskdesc = safe_text(alert.get("riskdesc"), 64)
    if riskdesc:
        head = riskdesc.split(" ", 1)[0].strip().lower()
        if head == "informational":
            return "Informational"
        if head in {"high", "medium", "low"}:
            return head.title()
    return RISK_FROM_CODE.get(str(alert.get("riskcode", "")))


def load_forbidden_values() -> list[str]:
    raw = os.environ.get("AIP_SECURITY_ZAP_FORBIDDEN_VALUES", "")
    if not raw:
        return []
    try:
        values = json.loads(raw)
    except json.JSONDecodeError as exc:
        fail(f"AIP_SECURITY_ZAP_FORBIDDEN_VALUES is invalid JSON: {exc}")
    if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
        fail("AIP_SECURITY_ZAP_FORBIDDEN_VALUES must be a JSON array of strings")
    return sorted({value for value in values if value})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-report", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--metadata", required=True, type=Path)
    parser.add_argument("--role", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--scanner-version", required=True)
    parser.add_argument("--scanner-image", required=True)
    parser.add_argument("--scanner-exit", required=True, type=int)
    parser.add_argument("--contract", required=True, type=Path)
    parser.add_argument("--automation-plan", required=True, type=Path)
    parser.add_argument("--policy", required=True, type=Path)
    parser.add_argument("--addon-list-sha256", required=True)
    args = parser.parse_args()

    required = (args.contract, args.automation_plan, args.policy)
    for path in required:
        if not path.is_file():
            fail(f"required input is missing: {path}")

    if not args.raw_report.is_file() or args.raw_report.stat().st_size == 0:
        fail("scanner reported without a non-empty JSON report")

    try:
        raw = json.loads(args.raw_report.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        fail(f"raw ZAP report is invalid JSON: {exc}")
    if not isinstance(raw, dict):
        fail("raw ZAP report root must be an object")

    target_origin = normalize_origin(args.target)
    sites = raw.get("site", [])
    if sites is None:
        sites = []
    if not isinstance(sites, list):
        fail("raw ZAP report site field must be an array")
    if args.scanner_exit == 0 and not sites:
        fail("scanner exited successfully without scanned-site coverage")

    risk_counts: Counter[str] = Counter()
    rule_counts: Counter[str] = Counter()
    instance_counts: Counter[str] = Counter()
    safe_alerts: list[dict[str, Any]] = []

    for site in sites:
        if not isinstance(site, dict):
            fail("site entry must be an object")
        site_name = site.get("@name")
        if site_name and normalize_origin(str(site_name)) != target_origin:
            fail(f"report contains non-target site {site_name!r}")
        alerts = site.get("alerts", []) or []
        if not isinstance(alerts, list):
            fail("site alerts must be an array")
        for alert in alerts:
            if not isinstance(alert, dict):
                fail("alert entry must be an object")
            plugin_id = (
                safe_text(alert.get("pluginid") or alert.get("alertRef"), 40) or "unknown"
            )
            risk = normalize_risk(alert)
            if risk is None:
                fail(f"alert {plugin_id!r} has an unrecognized risk classification")
            name = (
                safe_text(alert.get("name") or alert.get("alert"), 160)
                or "Unnamed ZAP alert"
            )
            instances = alert.get("instances", []) or []
            if not isinstance(instances, list):
                fail("alert instances must be an array")

            safe_instances: list[dict[str, Any]] = []
            for instance in instances:
                if not isinstance(instance, dict):
                    fail("alert instance must be an object")
                location = safe_location(instance.get("uri"), target_origin)
                entry: dict[str, Any] = {
                    "method": safe_text(instance.get("method"), 16).upper() or "UNKNOWN",
                    "parameter": safe_text(instance.get("param"), 120),
                }
                if location is not None:
                    entry.update(location)
                safe_instances.append(entry)

            declared_count = alert.get("count")
            try:
                count = int(declared_count) if declared_count is not None else len(instances)
            except (TypeError, ValueError):
                fail(f"invalid instance count for rule {plugin_id!r}")
            count = max(count, len(instances), 0)

            risk_counts[risk] += 1
            rule_counts[plugin_id] += 1
            instance_counts[plugin_id] += count
            safe_alerts.append(
                {
                    "ruleId": plugin_id,
                    "name": name,
                    "risk": risk,
                    "confidence": safe_text(alert.get("confidence"), 40),
                    "cweId": safe_text(alert.get("cweid"), 20),
                    "wascId": safe_text(alert.get("wascid"), 20),
                    "instanceCount": count,
                    "instances": safe_instances[:25],
                }
            )

    safe_alerts.sort(
        key=lambda item: (
            RISK_ORDER.index(item["risk"]) if item["risk"] in RISK_ORDER else 99,
            item["ruleId"],
            item["name"],
        )
    )

    evidence = {
        "schemaVersion": 1,
        "control": "SEC-06",
        "scanner": {
            "name": "OWASP ZAP",
            "version": args.scanner_version,
            "image": args.scanner_image,
            "exitCode": args.scanner_exit,
        },
        "role": args.role,
        "target": {
            "origin": target_origin,
            "isolated": True,
            "externalNetworkAccess": False,
        },
        "inputs": {
            "openApiSha256": sha256_file(args.contract),
            "automationPlanSha256": sha256_file(args.automation_plan),
            "policySha256": sha256_file(args.policy),
            "addonListSha256": args.addon_list_sha256,
        },
        "summary": {
            "uniqueAlertsByRisk": {
                risk: risk_counts.get(risk, 0) for risk in RISK_ORDER
            },
            "uniqueAlertsByRule": dict(sorted(rule_counts.items())),
            "instancesByRule": dict(sorted(instance_counts.items())),
            "blockingHighAlerts": risk_counts.get("High", 0),
        },
        "alerts": safe_alerts,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.metadata.parent.mkdir(parents=True, exist_ok=True)
    rendered = json.dumps(evidence, indent=2, sort_keys=True) + "\n"

    forbidden = load_forbidden_values()
    for value in forbidden:
        if value in rendered:
            fail("sanitized evidence still contains ephemeral authentication material")

    args.output.write_text(rendered, encoding="utf-8")
    args.metadata.write_text(
        json.dumps(
            {
                "control": "SEC-06",
                "role": args.role,
                "status": (
                    "blocked-high"
                    if risk_counts.get("High", 0)
                    else ("scanner-failed" if args.scanner_exit != 0 else "passed")
                ),
                "scannerVersion": args.scanner_version,
                "scannerImage": args.scanner_image,
                "openApiSha256": evidence["inputs"]["openApiSha256"],
                "automationPlanSha256": evidence["inputs"]["automationPlanSha256"],
                "policySha256": evidence["inputs"]["policySha256"],
                "addonListSha256": args.addon_list_sha256,
                "highAlerts": risk_counts.get("High", 0),
                "mediumAlerts": risk_counts.get("Medium", 0),
                "lowAlerts": risk_counts.get("Low", 0),
                "informationalAlerts": risk_counts.get("Informational", 0),
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )

    if args.scanner_exit != 0:
        if risk_counts.get("High", 0):
            fail(
                f"scanner exited {args.scanner_exit} with "
                f"{risk_counts['High']} High-risk alert type(s); High findings are blocking"
            )
        fail(
            f"scanner exited non-zero ({args.scanner_exit}); "
            "ZAP failure/timeout cannot be green"
        )
    if risk_counts.get("High", 0):
        fail(f"{risk_counts['High']} High-risk alert type(s) are blocking")

    print(
        "SEC-06 ZAP report accepted: "
        f"role={args.role} high={risk_counts.get('High', 0)} "
        f"medium={risk_counts.get('Medium', 0)} low={risk_counts.get('Low', 0)} "
        f"info={risk_counts.get('Informational', 0)}"
    )


if __name__ == "__main__":
    main()
