#!/usr/bin/env python3
"""Validate the SEC-01 build-time OpenAPI contract and AV-MIG P0 boundary."""

from __future__ import annotations

import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
AVALONIA_BOUNDARY_POLICY = REPO_ROOT / "docs/migration/avalonia/p0-api-boundary.json"


def fail(message: str) -> None:
    print(f"SEC-01 OpenAPI verification failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def require_wire_schema(
    schemas: dict[str, object],
    name: str,
    expected_types: set[str],
    expected_format: str | None = None,
) -> None:
    schema = schemas.get(name)
    if not isinstance(schema, dict) or not schema:
        fail(f"component schema {name!r} must be present and non-empty")

    raw_types = schema.get("type")
    if isinstance(raw_types, str):
        actual_types = {raw_types}
    elif isinstance(raw_types, list) and all(isinstance(item, str) for item in raw_types):
        actual_types = set(raw_types)
    else:
        fail(f"component schema {name!r} has invalid type {raw_types!r}")

    if actual_types != expected_types:
        fail(
            f"component schema {name!r} must expose wire types "
            f"{sorted(expected_types)!r}, got {sorted(actual_types)!r}"
        )

    actual_format = schema.get("format")
    if actual_format != expected_format:
        fail(
            f"component schema {name!r} must expose format "
            f"{expected_format!r}, got {actual_format!r}"
        )


def require_operation(
    paths: object,
    path: str,
    method: str,
    description: str,
) -> dict[str, object]:
    path_item = paths.get(path) if isinstance(paths, dict) else None
    operation = path_item.get(method) if isinstance(path_item, dict) else None
    responses = operation.get("responses") if isinstance(operation, dict) else None
    if not isinstance(operation, dict) or not isinstance(responses, dict) or not responses:
        fail(f"{description} operation must be present: {method.upper()} {path}")
    return operation


def require_security_contract(document: dict[str, object]) -> None:
    components = document.get("components")
    security_schemes = components.get("securitySchemes") if isinstance(components, dict) else None
    cookie_auth = security_schemes.get("CookieAuth") if isinstance(security_schemes, dict) else None
    if not isinstance(cookie_auth, dict):
        fail("CookieAuth security scheme must be present")
    if cookie_auth.get("type") != "apiKey" or cookie_auth.get("in") != "cookie":
        fail("CookieAuth must be an apiKey cookie security scheme")
    if cookie_auth.get("name") != ".AipPortal.Auth":
        fail("CookieAuth must describe the production authentication cookie")

    paths = document.get("paths")
    if isinstance(paths, dict):
        non_api_paths = {"/", "/health", "/favicon.ico"}.intersection(paths)
        if non_api_paths:
            fail(
                "navigation and static aliases must not be advertised as API operations: "
                f"{sorted(non_api_paths)!r}"
            )

    # SEC-04 excludes the announcement collection from destructive fuzzing and
    # relies on SEC-06's OpenAPI-driven authenticated scan as the compensating
    # control. Keep that dependency fail-closed by requiring the operations that
    # exercise announcement audience lookup, object reads, and read mutation.
    for method, path, description in (
        ("get", "/api/announcements/audiences", "announcement audiences"),
        ("get", "/api/announcements/{announcementId}", "announcement detail"),
        ("post", "/api/announcements/{announcementId}/read", "announcement read marker"),
    ):
        require_operation(paths, path, method, description)

    export_path = paths.get("/api/admin/audit/package-exports") if isinstance(paths, dict) else None
    export_operation = export_path.get("post") if isinstance(export_path, dict) else None
    if not isinstance(export_operation, dict):
        fail("audit package export POST operation must be present")

    responses = export_operation.get("responses")
    required_responses = {"400", "401", "403", "404", "415"}
    if not isinstance(responses, dict) or not required_responses.issubset(responses):
        fail("protected request-body operations must document 400/401/403/404/415 responses")
    for status in required_responses:
        response = responses.get(status)
        content = response.get("content") if isinstance(response, dict) else None
        required_error_media_types = {"application/json", "application/problem+json"}
        if not isinstance(content, dict) or not required_error_media_types.issubset(content):
            fail(
                f"cross-cutting {status} responses must document JSON and Problem Details"
            )

    security = export_operation.get("security")
    if not isinstance(security, list) or not any(
        isinstance(requirement, dict) and "CookieAuth" in requirement
        for requirement in security
    ):
        fail("protected operations must require CookieAuth")

    request_content = export_operation.get("requestBody")
    request_content = request_content.get("content") if isinstance(request_content, dict) else None
    if not isinstance(request_content, dict):
        fail("audit package export POST request content must be present")
    if "application/json" not in request_content or "application/*+json" not in request_content:
        fail("JSON request bodies must retain ordinary and structured-suffix media types")
    if "text/json" in request_content:
        fail("security contract must not advertise runtime-rejected text/json request bodies")

    dependency_path = paths.get("/api/tasks/{taskItemId}/dependencies") if isinstance(paths, dict) else None
    dependency_operation = dependency_path.get("post") if isinstance(dependency_path, dict) else None
    dependency_responses = dependency_operation.get("responses") if isinstance(dependency_operation, dict) else None
    if not isinstance(dependency_responses, dict) or not {"401", "403", "404"}.issubset(dependency_responses):
        fail("application-authorized path operations must document 401/403/404 responses")

    invite_path = paths.get("/api/invites/validate") if isinstance(paths, dict) else None
    invite_operation = invite_path.get("get") if isinstance(invite_path, dict) else None
    invite_parameters = invite_operation.get("parameters") if isinstance(invite_operation, dict) else None
    invite_token = next(
        (
            parameter
            for parameter in invite_parameters or []
            if isinstance(parameter, dict) and parameter.get("name") == "token"
        ),
        None,
    )
    invite_schema = invite_token.get("schema") if isinstance(invite_token, dict) else None
    if not isinstance(invite_token, dict) or invite_token.get("required") is not True:
        fail("invite validation token must be a required query parameter")
    if not isinstance(invite_schema, dict) or invite_schema.get("pattern") != "^[a-f0-9]{64}$":
        fail("invite validation token must document the generated 64-character hex format")
    invite_responses = invite_operation.get("responses") if isinstance(invite_operation, dict) else None
    if not isinstance(invite_responses, dict) or "404" not in invite_responses:
        fail("well-formed unknown invite tokens must be documented as 404")
    for status in ("400", "404"):
        response = invite_responses.get(status) if isinstance(invite_responses, dict) else None
        content = response.get("content") if isinstance(response, dict) else None
        if not isinstance(content, dict) or "application/problem+json" not in content:
            fail(f"invite validation {status} must document application/problem+json")

    for schema_name, token_property in (
        ("AcceptInviteRequest", "token"),
        ("RegisterByInviteRequest", "inviteToken"),
    ):
        request_schema = components.get("schemas", {}).get(schema_name) if isinstance(components, dict) else None
        properties = request_schema.get("properties") if isinstance(request_schema, dict) else None
        token_schema = properties.get(token_property) if isinstance(properties, dict) else None
        if not isinstance(token_schema, dict) or token_schema.get("pattern") != "^[a-f0-9]{64}$":
            fail(f"{schema_name}.{token_property} must document the generated invite-token format")

    for path_name in ("/api/invites/accept", "/api/auth/register-by-invite"):
        path_item = paths.get(path_name) if isinstance(paths, dict) else None
        post_operation = path_item.get("post") if isinstance(path_item, dict) else None
        post_responses = post_operation.get("responses") if isinstance(post_operation, dict) else None
        if not isinstance(post_responses, dict) or "404" not in post_responses:
            fail(f"well-formed unknown invite tokens must be documented as 404 for {path_name}")
        not_found = post_responses.get("404")
        content = not_found.get("content") if isinstance(not_found, dict) else None
        if not isinstance(content, dict) or "application/problem+json" not in content:
            fail(f"invite 404 responses must document application/problem+json for {path_name}")


def require_avalonia_contract_boundary(document: dict[str, object]) -> None:
    """Fail closed when a migration-blocking client-independent API disappears."""
    if not AVALONIA_BOUNDARY_POLICY.is_file():
        fail(f"AV-MIG boundary policy is missing: {AVALONIA_BOUNDARY_POLICY}")

    try:
        policy = json.loads(AVALONIA_BOUNDARY_POLICY.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        fail(f"AV-MIG boundary policy is not valid UTF-8 JSON: {exc}")

    if not isinstance(policy, dict) or policy.get("version") != 1:
        fail("AV-MIG boundary policy must be an object with version=1")

    openapi_policy = policy.get("openapi")
    if not isinstance(openapi_policy, dict):
        fail("AV-MIG boundary policy openapi section is missing")

    required_version_prefix = openapi_policy.get("requiredVersionPrefix")
    actual_version = document.get("openapi")
    if not isinstance(required_version_prefix, str) or not isinstance(actual_version, str):
        fail("AV-MIG OpenAPI version policy is invalid")
    if not actual_version.startswith(required_version_prefix):
        fail(
            "AV-MIG client boundary requires OpenAPI version prefix "
            f"{required_version_prefix!r}, got {actual_version!r}"
        )

    security_policy = openapi_policy.get("requiredSecurityScheme")
    components = document.get("components")
    security_schemes = components.get("securitySchemes") if isinstance(components, dict) else None
    if not isinstance(security_policy, dict) or not isinstance(security_schemes, dict):
        fail("AV-MIG CookieAuth policy or OpenAPI securitySchemes are missing")

    scheme_name = security_policy.get("name")
    scheme = security_schemes.get(scheme_name) if isinstance(scheme_name, str) else None
    if not isinstance(scheme, dict):
        fail(f"AV-MIG required security scheme is missing: {scheme_name!r}")

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
    if actual_security != expected_security:
        fail(
            "AV-MIG CookieAuth scheme drifted: "
            f"expected {expected_security!r}, got {actual_security!r}"
        )

    paths = document.get("paths")
    if not isinstance(paths, dict):
        fail("AV-MIG boundary requires OpenAPI paths")

    required_operations = policy.get("requiredOperations")
    if not isinstance(required_operations, list) or not required_operations:
        fail("AV-MIG boundary policy must define requiredOperations")

    seen_ids: set[str] = set()
    for entry in required_operations:
        if not isinstance(entry, dict):
            fail("AV-MIG requiredOperations entries must be objects")

        operation_id = entry.get("id")
        path = entry.get("path")
        method = entry.get("method")
        anonymous = entry.get("anonymous")
        if (
            not isinstance(operation_id, str)
            or not operation_id
            or operation_id in seen_ids
            or not isinstance(path, str)
            or not path.startswith("/api/")
            or not isinstance(method, str)
            or method.lower() not in {"get", "post", "put", "patch", "delete"}
            or not isinstance(anonymous, bool)
        ):
            fail(f"invalid AV-MIG required operation entry: {entry!r}")
        seen_ids.add(operation_id)

        operation = require_operation(paths, path, method.lower(), f"AV-MIG {operation_id}")

        # A protected sentinel must not explicitly opt out of operation-level
        # security. Absence is allowed because OpenAPI may inherit a document-
        # level security requirement; an explicit empty list means anonymous.
        if not anonymous and operation.get("security") == []:
            fail(
                f"AV-MIG protected operation became explicitly anonymous: "
                f"{method.upper()} {path} ({operation_id})"
            )


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: verify-openapi.py <openapi.json>")

    path = Path(sys.argv[1])
    if not path.is_file():
        fail(f"document is missing: {path}")
    if path.stat().st_size == 0:
        fail(f"document is empty: {path}")

    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        fail(f"document is not valid UTF-8 JSON: {exc}")

    version = document.get("openapi")
    if not isinstance(version, str) or not version.startswith("3.1."):
        fail(f"expected OpenAPI 3.1.x, got {version!r}")

    paths = document.get("paths")
    if not isinstance(paths, dict) or not paths:
        fail("document must contain at least one path")

    components = document.get("components")
    schemas = components.get("schemas") if isinstance(components, dict) else None
    if not isinstance(schemas, dict):
        fail("document must contain component schemas")

    # These PATCH sentinel structs use custom System.Text.Json converters. Their
    # OpenAPI representation must match the JSON wire format, not the CLR shape;
    # otherwise Schemathesis/ZAP would fuzz them as unconstrained objects.
    require_wire_schema(
        schemas,
        "OptionalDateTimeOffset",
        {"null", "string"},
        "date-time",
    )
    require_wire_schema(schemas, "OptionalString", {"null", "string"})
    require_security_contract(document)
    require_avalonia_contract_boundary(document)

    print(
        "SEC-01 OpenAPI verification passed: "
        f"version={version}, paths={len(paths)}, bytes={path.stat().st_size}, "
        "av-mig-boundary=pass"
    )


if __name__ == "__main__":
    main()
