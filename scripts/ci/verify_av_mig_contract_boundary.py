#!/usr/bin/env python3
"""Verify the AV-MIG-02 client-independent P0 contract boundary."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_POLICY = REPO_ROOT / "docs/migration/avalonia/p0-api-boundary.json"


class BoundaryViolation(RuntimeError):
    """Raised when the pinned migration contract drifts."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise BoundaryViolation(message)


def load_policy(path: Path) -> dict[str, Any]:
    try:
        policy = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise BoundaryViolation(f"boundary policy is not valid UTF-8 JSON: {exc}") from exc
    require(isinstance(policy, dict) and policy.get("version") == 1,
            "boundary policy must be an object with version=1")
    return policy


def has_security_requirement(operation: dict[str, Any], scheme_name: str) -> bool:
    security = operation.get("security")
    if not isinstance(security, list):
        return False
    return any(
        isinstance(requirement, dict) and scheme_name in requirement
        for requirement in security
    )


def verify_openapi_contract(document: dict[str, Any], policy: dict[str, Any]) -> None:
    openapi_policy = policy.get("openapi")
    require(isinstance(openapi_policy, dict), "openapi policy section is missing")

    required_version_prefix = openapi_policy.get("requiredVersionPrefix")
    actual_version = document.get("openapi")
    require(
        isinstance(required_version_prefix, str)
        and isinstance(actual_version, str)
        and actual_version.startswith(required_version_prefix),
        f"OpenAPI version must start with {required_version_prefix!r}, got {actual_version!r}",
    )

    security_policy = openapi_policy.get("requiredSecurityScheme")
    components = document.get("components")
    security_schemes = components.get("securitySchemes") if isinstance(components, dict) else None
    require(isinstance(security_policy, dict) and isinstance(security_schemes, dict),
            "CookieAuth policy or OpenAPI securitySchemes are missing")

    scheme_name = security_policy.get("name")
    require(isinstance(scheme_name, str) and bool(scheme_name),
            "required security scheme name is invalid")
    scheme = security_schemes.get(scheme_name)
    require(isinstance(scheme, dict), f"required security scheme is missing: {scheme_name!r}")

    expected_security = {
        "type": security_policy.get("type"),
        "in": security_policy.get("in"),
        "name": security_policy.get("parameterName"),
    }
    actual_security = {
        "type": scheme.get("type"),
        "in": scheme.get("in"),
        "name": scheme.get("name"),
    }
    require(
        actual_security == expected_security,
        f"CookieAuth scheme drifted: expected {expected_security!r}, got {actual_security!r}",
    )

    paths = document.get("paths")
    require(isinstance(paths, dict), "OpenAPI paths are missing")
    required_operations = policy.get("requiredOperations")
    require(isinstance(required_operations, list) and bool(required_operations),
            "requiredOperations must be a non-empty array")

    seen_ids: set[str] = set()
    for entry in required_operations:
        require(isinstance(entry, dict), "requiredOperations entries must be objects")
        operation_id = entry.get("id")
        path = entry.get("path")
        method = entry.get("method")
        anonymous = entry.get("anonymous")
        valid = (
            isinstance(operation_id, str)
            and bool(operation_id)
            and operation_id not in seen_ids
            and isinstance(path, str)
            and path.startswith("/api/")
            and isinstance(method, str)
            and method.lower() in {"get", "post", "put", "patch", "delete"}
            and isinstance(anonymous, bool)
        )
        require(valid, f"invalid required operation entry: {entry!r}")
        seen_ids.add(operation_id)

        path_item = paths.get(path)
        operation = path_item.get(method.lower()) if isinstance(path_item, dict) else None
        responses = operation.get("responses") if isinstance(operation, dict) else None
        require(
            isinstance(operation, dict) and isinstance(responses, dict) and bool(responses),
            f"required operation is missing: {method.upper()} {path} ({operation_id})",
        )

        has_cookie_auth = has_security_requirement(operation, scheme_name)
        if anonymous:
            require(
                not has_cookie_auth,
                f"anonymous operation must not require {scheme_name}: "
                f"{method.upper()} {path} ({operation_id})",
            )
        else:
            # The generator emits operation-level security. Do not accept
            # document-level inheritance or merely non-empty security here.
            require(
                has_cookie_auth,
                f"protected operation must explicitly require {scheme_name}: "
                f"{method.upper()} {path} ({operation_id})",
            )


def read_source(repo_root: Path, relative_path: str) -> str:
    path = repo_root / relative_path
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise BoundaryViolation(f"required source file is unreadable: {relative_path}: {exc}") from exc


def verify_signalr_contract(policy: dict[str, Any], repo_root: Path) -> None:
    contracts = policy.get("nonOpenApiContracts")
    signalr = contracts.get("signalR") if isinstance(contracts, dict) else None
    require(isinstance(signalr, dict), "nonOpenApiContracts.signalR is missing")

    expected_path = signalr.get("path")
    client_methods = signalr.get("clientMethods")
    server_events = signalr.get("serverEvents")
    require(isinstance(expected_path, str) and expected_path.startswith("/"),
            "signalR.path must be an absolute path")
    require(
        isinstance(client_methods, list)
        and bool(client_methods)
        and all(isinstance(item, str) and item for item in client_methods)
        and len(set(client_methods)) == len(client_methods),
        "signalR.clientMethods must be a non-empty unique string array",
    )
    require(
        isinstance(server_events, list)
        and bool(server_events)
        and all(isinstance(item, str) and item for item in server_events)
        and len(set(server_events)) == len(server_events),
        "signalR.serverEvents must be a non-empty unique string array",
    )

    program = read_source(repo_root, "src/AipPortal.Web/Program.cs")
    hub = read_source(repo_root, "src/AipPortal.Web/Realtime/AppHub.cs")
    realtime_dir = repo_root / "src/AipPortal.Web/Realtime"
    require(realtime_dir.is_dir(), "Realtime source directory is missing")

    mapped_paths = re.findall(
        r'MapHub\s*<\s*AppHub\s*>\s*\(\s*"([^"]+)"\s*\)',
        program,
    )
    require(
        mapped_paths == [expected_path],
        f"SignalR AppHub path drifted: expected {[expected_path]!r}, got {mapped_paths!r}",
    )

    for method in client_methods:
        pattern = re.compile(
            rf"public\s+[^\n{{;=]+\b{re.escape(method)}\s*\(",
            re.MULTILINE,
        )
        require(
            pattern.search(hub) is not None,
            f"SignalR client method is missing from AppHub: {method}",
        )

    emitted_events: set[str] = set()
    for source_path in sorted(realtime_dir.glob("*.cs")):
        source = read_source(repo_root, str(source_path.relative_to(repo_root)))
        emitted_events.update(
            re.findall(r'\.SendAsync\(\s*"([^"]+)"', source, flags=re.MULTILINE)
        )

    for event_name in server_events:
        require(
            event_name in emitted_events,
            f"SignalR server event is not emitted by realtime sources: {event_name}",
        )


def verify_csrf_contract(policy: dict[str, Any], repo_root: Path) -> None:
    contracts = policy.get("nonOpenApiContracts")
    csrf = contracts.get("csrf") if isinstance(contracts, dict) else None
    require(isinstance(csrf, dict), "nonOpenApiContracts.csrf is missing")

    expected_endpoint = csrf.get("tokenEndpoint")
    expected_header = csrf.get("headerName")
    require(isinstance(expected_endpoint, str) and expected_endpoint.startswith("/api/"),
            "csrf.tokenEndpoint must be an /api/ path")
    require(isinstance(expected_header, str) and bool(expected_header),
            "csrf.headerName must be a non-empty string")

    controller = read_source(repo_root, "src/AipPortal.Web/Controllers/SecurityController.cs")
    options = read_source(repo_root, "src/AipPortal.Web/Configuration/SecurityOptions.cs")

    controller_route = re.search(r'\[Route\("([^"]+)"\)\]', controller)
    csrf_action = re.search(
        r'\[HttpGet\("([^"]+)"\)\]\s*'
        r'\[AllowAnonymous\]\s*'
        r'public\s+ActionResult<CsrfTokenResponse>\s+CsrfToken\s*\(',
        controller,
        flags=re.MULTILINE,
    )
    require(controller_route is not None and csrf_action is not None,
            "CSRF token controller route/action contract is missing")
    actual_endpoint = "/" + "/".join(
        part.strip("/")
        for part in (controller_route.group(1), csrf_action.group(1))
        if part.strip("/")
    )
    require(
        actual_endpoint == expected_endpoint,
        f"CSRF token endpoint drifted: expected {expected_endpoint!r}, got {actual_endpoint!r}",
    )

    header_match = re.search(
        r'CsrfHeaderName\s*=\s*"([^"]+)"\s*;',
        options,
    )
    require(header_match is not None, "SecurityOptions.CsrfHeaderName is missing")
    actual_header = header_match.group(1)
    require(
        actual_header == expected_header,
        f"CSRF header drifted: expected {expected_header!r}, got {actual_header!r}",
    )
    require(
        re.search(
            r'CsrfTokenResponse\s*\(\s*tokens\.RequestToken\s*\?\?\s*string\.Empty\s*,\s*'
            r'SecurityOptions\.CsrfHeaderName\s*\)',
            controller,
            flags=re.MULTILINE,
        )
        is not None,
        "CSRF token response must expose SecurityOptions.CsrfHeaderName",
    )


def verify_boundary(document: dict[str, Any], policy: dict[str, Any], repo_root: Path) -> None:
    verify_openapi_contract(document, policy)
    verify_signalr_contract(policy, repo_root)
    verify_csrf_contract(policy, repo_root)


def main() -> int:
    if len(sys.argv) != 2:
        print(
            "AV-MIG contract boundary verification failed: "
            "usage: verify_av_mig_contract_boundary.py <openapi.json>",
            file=sys.stderr,
        )
        return 2

    document_path = Path(sys.argv[1])
    try:
        document = json.loads(document_path.read_text(encoding="utf-8"))
        require(isinstance(document, dict), "OpenAPI document must be a JSON object")
        policy = load_policy(DEFAULT_POLICY)
        verify_boundary(document, policy, REPO_ROOT)
    except (OSError, UnicodeError, json.JSONDecodeError, BoundaryViolation) as exc:
        print(f"AV-MIG contract boundary verification failed: {exc}", file=sys.stderr)
        return 1

    print(
        "AV-MIG contract boundary verification passed: "
        "CookieAuth operations, SignalR path/method/events, and CSRF endpoint/header are pinned"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
