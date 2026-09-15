#!/usr/bin/env python3
"""AV-MIG-02 verifier with fail-closed SignalR runtime-contract hardening."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

import verify_av_mig_contract_boundary_base as base


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_POLICY = REPO_ROOT / "docs/migration/avalonia/p0-api-boundary.json"

BoundaryViolation = base.BoundaryViolation
require = base.require
load_policy = base.load_policy


def _attribute_present(attributes: str, name: str) -> bool:
    return re.search(
        rf"\b(?:[A-Za-z_]\w*\.)*{re.escape(name)}(?:Attribute)?\b",
        attributes,
    ) is not None


def _direct_member_text_preserving_literals(class_body: str) -> str:
    """Keep AppHub depth-zero member declarations and blank nested bodies/types."""
    output: list[str] = []
    depth = 0
    index = 0
    state = "code"

    while index < len(class_body):
        char = class_body[index]
        next_char = class_body[index + 1] if index + 1 < len(class_body) else ""
        visible = depth == 0

        if state == "string":
            output.append(char if visible else (char if char in "\r\n" else " "))
            if char == "\\" and index + 1 < len(class_body):
                output.append(class_body[index + 1] if visible else " ")
                index += 2
                continue
            if char == '"':
                state = "code"
            index += 1
            continue

        if state == "verbatim_string":
            output.append(char if visible else (char if char in "\r\n" else " "))
            if char == '"' and next_char == '"':
                output.append(next_char if visible else " ")
                index += 2
                continue
            if char == '"':
                state = "code"
            index += 1
            continue

        if state == "char":
            output.append(char if visible else (char if char in "\r\n" else " "))
            if char == "\\" and index + 1 < len(class_body):
                output.append(class_body[index + 1] if visible else " ")
                index += 2
                continue
            if char == "'":
                state = "code"
            index += 1
            continue

        if char == '"':
            is_verbatim = (
                (index > 0 and class_body[index - 1] == "@")
                or (index > 1 and class_body[index - 2:index] == "@$")
            )
            state = "verbatim_string" if is_verbatim else "string"
            output.append(char if visible else " ")
        elif char == "'":
            state = "char"
            output.append(char if visible else " ")
        elif char == "{":
            output.append(char if visible else " ")
            depth += 1
        elif char == "}":
            depth = max(0, depth - 1)
            output.append(char if depth == 0 else " ")
        else:
            output.append(char if visible or char in "\r\n" else " ")
        index += 1

    return "".join(output)


def _hub_method_public_name(attributes: str, csharp_name: str) -> str:
    aliases = re.findall(
        r'\b(?:[A-Za-z_]\w*\.)*HubMethodName(?:Attribute)?\s*\(\s*"([^"]+)"\s*\)',
        attributes,
    )
    require(
        len(aliases) <= 1,
        f"SignalR method has multiple HubMethodName attributes: {csharp_name}",
    )
    return aliases[0] if aliases else csharp_name


def _extract_direct_public_methods(class_body: str) -> list[dict[str, Any]]:
    direct = _direct_member_text_preserving_literals(class_body)
    pattern = re.compile(
        r"(?P<attributes>(?:\s*\[[^\]]+\]\s*)*)"
        r"\bpublic\s+"
        r"(?P<modifiers>(?:(?:static|virtual|override|sealed|async|new|unsafe|extern|partial)\s+)*)"
        r"(?P<return>[^(){};=\r\n]+?)\s+"
        r"(?P<name>[A-Za-z_]\w*)\s*"
        r"\((?P<parameters>[^()]*)\)",
        flags=re.MULTILINE,
    )

    methods: list[dict[str, Any]] = []
    for match in pattern.finditer(direct):
        attributes = match.group("attributes") or ""
        modifiers = set(match.group("modifiers").split())
        csharp_name = match.group("name")
        parameter_types = tuple(
            base.csharp_parameter_type(parameter)
            for parameter in base.split_csharp_parameters(match.group("parameters"))
        )
        methods.append(
            {
                "csharpName": csharp_name,
                "publicName": _hub_method_public_name(attributes, csharp_name),
                "returnType": base.normalize_csharp_type(match.group("return")),
                "parameterTypes": parameter_types,
                "static": "static" in modifiers,
                "nonHub": _attribute_present(attributes, "NonHubMethod"),
            }
        )
    return methods


def _normalized_expected_signatures(signalr: dict[str, Any]) -> list[tuple[str, str, tuple[str, ...]]]:
    signatures = signalr.get("clientMethodSignatures")
    require(isinstance(signatures, list), "signalR.clientMethodSignatures must be an array")
    result: list[tuple[str, str, tuple[str, ...]]] = []
    for item in signatures:
        require(isinstance(item, dict), "signalR.clientMethodSignatures entries must be objects")
        name = item.get("name")
        return_type = item.get("returnType")
        parameter_types = item.get("parameterTypes")
        require(
            isinstance(name, str) and name
            and isinstance(return_type, str) and return_type
            and isinstance(parameter_types, list)
            and all(isinstance(parameter, str) and parameter for parameter in parameter_types),
            f"invalid SignalR client method signature: {item!r}",
        )
        result.append(
            (
                name,
                base.normalize_csharp_type(return_type),
                tuple(base.normalize_csharp_type(parameter) for parameter in parameter_types),
            )
        )
    return result


def verify_signalr_contract(
    policy: dict[str, Any],
    repo_root: Path,
    defined_symbols: set[str],
) -> None:
    """Run the baseline verifier, then pin effective SignalR callable semantics."""
    base.verify_signalr_contract(policy, repo_root, defined_symbols)

    contracts = policy.get("nonOpenApiContracts")
    signalr = contracts.get("signalR") if isinstance(contracts, dict) else None
    require(isinstance(signalr, dict), "nonOpenApiContracts.signalR is missing")
    expected_path = signalr.get("path")
    require(isinstance(expected_path, str), "signalR.path must be a string")

    program = base.read_live_csharp_source(
        repo_root,
        "src/AipPortal.Web/Program.cs",
        defined_symbols,
    )
    hub_source = base.read_live_csharp_source(
        repo_root,
        "src/AipPortal.Web/Realtime/AppHub.cs",
        defined_symbols,
    )

    hub_declaration = re.search(
        r"(?P<attributes>(?:\s*\[[^\]]+\]\s*)*)public\s+sealed\s+class\s+AppHub\b",
        hub_source,
        flags=re.MULTILINE,
    )
    require(hub_declaration is not None, "SignalR AppHub public sealed class declaration is missing")
    hub_attributes = hub_declaration.group("attributes") or ""
    require(
        not _attribute_present(hub_attributes, "AllowAnonymous"),
        "SignalR AppHub must not allow [AllowAnonymous]",
    )

    mappings = list(
        re.finditer(
            r'MapHub\s*<\s*AppHub\s*>\s*\(\s*"(?P<path>[^"]+)"\s*\)(?P<chain>[^;]*);',
            program,
            flags=re.MULTILINE | re.DOTALL,
        )
    )
    require(
        len(mappings) == 1 and mappings[0].group("path") == expected_path,
        "SignalR AppHub mapping must remain unique before authorization metadata is evaluated",
    )
    require(
        re.search(r"\bAllowAnonymous(?:Attribute)?\b", mappings[0].group("chain")) is None,
        "SignalR AppHub endpoint must not allow anonymous access",
    )

    hub_body = base.extract_csharp_class_body(hub_source, "AppHub")
    methods = [
        method
        for method in _extract_direct_public_methods(hub_body)
        if not method["static"] and not method["nonHub"]
    ]
    by_public_name: dict[str, list[dict[str, Any]]] = {}
    for method in methods:
        by_public_name.setdefault(method["publicName"], []).append(method)

    duplicate_names = sorted(
        name for name, candidates in by_public_name.items() if len(candidates) > 1
    )
    require(
        not duplicate_names,
        "SignalR public hub method names must be unique; "
        f"duplicates: {duplicate_names!r}",
    )

    for name, return_type, parameter_types in _normalized_expected_signatures(signalr):
        candidates = by_public_name.get(name, [])
        require(
            len(candidates) == 1,
            f"SignalR callable public method is missing from AppHub: {name}",
        )
        candidate = candidates[0]
        actual_signature = (candidate["returnType"], candidate["parameterTypes"])
        expected_signature = (return_type, parameter_types)
        require(
            actual_signature == expected_signature,
            f"SignalR callable public method signature drifted for {name}: "
            f"expected {expected_signature!r}, got {actual_signature!r}",
        )


def verify_boundary(document: dict[str, Any], policy: dict[str, Any], repo_root: Path) -> None:
    defined_symbols = base.resolve_effective_csharp_symbols(policy, repo_root)
    base.verify_openapi_contract(document, policy)
    verify_signalr_contract(policy, repo_root, defined_symbols)
    base.verify_csrf_contract(policy, repo_root, defined_symbols)


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
        "CookieAuth, authenticated SignalR endpoint/callable public methods, and CSRF are pinned"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
