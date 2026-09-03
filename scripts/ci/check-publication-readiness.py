#!/usr/bin/env python3
"""Fail closed when repository files violate the public-visibility policy."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW_DIR = ROOT / ".github" / "workflows"

REQUIRED_FILES = (
    ROOT / "COPYRIGHT.md",
    ROOT / "CONTRIBUTING.md",
    ROOT / "THIRD_PARTY_NOTICES.md",
    ROOT / ".github" / "SECURITY.md",
    ROOT / ".github" / "CODEOWNERS",
    ROOT / "docs" / "PUBLICATION_RUNBOOK.md",
    ROOT / ".gitleaksignore",
)

FORBIDDEN_EXACT_NAMES = {
    ".env",
    "id_rsa",
    "id_ed25519",
    "syncfusion-license.txt",
    "syncfusion_license.txt",
}
FORBIDDEN_SUFFIXES = (".p12", ".pfx")


def _without_comment(line: str) -> str:
    """Remove ordinary YAML comments without attempting a full YAML parse."""
    quote: str | None = None
    escaped = False
    result: list[str] = []
    for char in line:
        if escaped:
            result.append(char)
            escaped = False
            continue
        if char == "\\" and quote == '"':
            result.append(char)
            escaped = True
            continue
        if char in {"'", '"'}:
            if quote is None:
                quote = char
            elif quote == char:
                quote = None
            result.append(char)
            continue
        if char == "#" and quote is None:
            break
        result.append(char)
    return "".join(result)


def workflow_triggers(text: str, event: str) -> bool:
    """Return whether a simple GitHub Actions ``on`` declaration includes event."""
    lines = text.splitlines()
    event_pattern = re.compile(rf"(^|[\s,\[]){re.escape(event)}([\s,\]:]|$)")

    for index, raw_line in enumerate(lines):
        line = _without_comment(raw_line).rstrip()
        if not re.match(r"^(?:on|'on'|\"on\")\s*:", line):
            continue

        _, value = line.split(":", 1)
        if value.strip():
            return bool(event_pattern.search(value))

        for nested_raw in lines[index + 1 :]:
            nested = _without_comment(nested_raw).rstrip()
            if not nested.strip():
                continue
            indent = len(nested) - len(nested.lstrip())
            if indent == 0:
                break
            stripped = nested.strip()
            if re.match(rf"^(?:-\s*)?{re.escape(event)}(?:\s*:|\s*$)", stripped):
                return True
        return False
    return False


def tracked_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=ROOT,
        check=True,
        stdout=subprocess.PIPE,
    )
    return [entry.decode("utf-8") for entry in result.stdout.split(b"\0") if entry]


def workflow_errors(path: Path, text: str) -> list[str]:
    errors: list[str] = []
    relative = path.relative_to(ROOT).as_posix()
    triggers_pr = workflow_triggers(text, "pull_request")
    triggers_pr_target = workflow_triggers(text, "pull_request_target")

    if triggers_pr_target:
        errors.append(f"{relative}: pull_request_target is forbidden")

    if re.search(r"(?im)^\s*runs-on\s*:\s*.*self-hosted", text):
        errors.append(f"{relative}: persistent self-hosted runner routing is forbidden")

    if triggers_pr and "${{ secrets." in text:
        errors.append(f"{relative}: pull-request workflow references a secret")

    if triggers_pr:
        for line_number, raw_line in enumerate(text.splitlines(), start=1):
            line = _without_comment(raw_line)
            if re.match(
                r"^\s*[A-Za-z0-9_-]+\s*:\s*(?:write|write-all)\s*$",
                line,
            ):
                errors.append(
                    f"{relative}:{line_number}: pull-request workflow requests write permission"
                )

    if "${{ secrets." in text and not re.search(
        r"(?m)^\s+environment\s*:\s*[^\s#]+", text
    ):
        errors.append(
            f"{relative}: secret-bearing workflow lacks a protected environment"
        )

    return errors


def manifest_errors(path: Path) -> list[str]:
    relative = path.relative_to(ROOT).as_posix()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [f"{relative}: cannot parse JSON: {exc}"]

    errors: list[str] = []
    if data.get("private") is not True:
        errors.append(f"{relative}: package must remain private")
    if data.get("license") != "UNLICENSED":
        errors.append(f"{relative}: license must be UNLICENSED")
    return errors


def repository_errors(paths: Iterable[str]) -> list[str]:
    errors: list[str] = []
    tracked = list(paths)

    for required in REQUIRED_FILES:
        if not required.is_file():
            errors.append(f"{required.relative_to(ROOT).as_posix()}: required file missing")

    ignore_path = ROOT / ".gitleaksignore"
    if ignore_path.is_file():
        fingerprint_pattern = re.compile(
            r"^[0-9a-f]{40}:[^:\n]+:[a-z0-9-]+:[1-9][0-9]*$"
        )
        for line_number, raw_line in enumerate(
            ignore_path.read_text(encoding="utf-8").splitlines(), start=1
        ):
            entry = raw_line.strip()
            if not entry or entry.startswith("#"):
                continue
            if not fingerprint_pattern.fullmatch(entry):
                errors.append(
                    f".gitleaksignore:{line_number}: only exact finding fingerprints are allowed"
                )

    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    if "Public source, not open source" not in readme:
        errors.append("README.md: public source notice missing")

    for manifest in (
        ROOT / "package.json",
        ROOT / "frontend" / "package.json",
        ROOT / "aipsite-frontend" / "package.json",
    ):
        errors.extend(manifest_errors(manifest))

    for lock_path in (
        ROOT / "package-lock.json",
        ROOT / "frontend" / "package-lock.json",
        ROOT / "aipsite-frontend" / "package-lock.json",
    ):
        relative = lock_path.relative_to(ROOT).as_posix()
        try:
            lock_data = json.loads(lock_path.read_text(encoding="utf-8"))
            root_package = lock_data.get("packages", {}).get("", {})
            if root_package.get("license") != "UNLICENSED":
                errors.append(f"{relative}: root package license must be UNLICENSED")
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"{relative}: cannot parse lock file: {exc}")

    for entry in tracked:
        path = Path(entry)
        lowered_name = path.name.lower()
        lowered_parts = {part.lower() for part in path.parts}

        if "secrets" in lowered_parts:
            errors.append(f"{entry}: tracked secrets directory is forbidden")
        if lowered_name in FORBIDDEN_EXACT_NAMES:
            errors.append(f"{entry}: tracked sensitive filename is forbidden")
        if lowered_name.startswith(".env.") and lowered_name != ".env.example":
            errors.append(f"{entry}: tracked environment file is forbidden")
        if lowered_name.endswith(FORBIDDEN_SUFFIXES):
            errors.append(f"{entry}: tracked private-key container is forbidden")

    for workflow in sorted(WORKFLOW_DIR.glob("*.y*ml")):
        errors.extend(workflow_errors(workflow, workflow.read_text(encoding="utf-8")))

    source_roots = (ROOT / "frontend" / "src",)
    for source_root in source_roots:
        for path in source_root.rglob("*"):
            if path.is_file() and path.suffix.lower() in {".ts", ".js", ".mjs"}:
                text = path.read_text(encoding="utf-8", errors="replace")
                if re.search(r"\bregisterLicense\s*\(", text):
                    errors.append(
                        f"{path.relative_to(ROOT).as_posix()}: browser-side Syncfusion license registration is forbidden"
                    )

    return errors


def main() -> int:
    errors = repository_errors(tracked_files())
    if errors:
        print("Publication-readiness policy failed:", file=sys.stderr)
        for error in sorted(set(errors)):
            print(f"- {error}", file=sys.stderr)
        return 1

    workflows = list(WORKFLOW_DIR.glob("*.y*ml"))
    print(
        "Publication-readiness policy passed: "
        f"{len(workflows)} workflow(s) checked; no active self-hosted routing, "
        "no PR secret access, required governance files present."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
