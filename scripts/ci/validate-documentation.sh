#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

python3 - <<'PY'
from pathlib import Path
import sys

errors = []
checked = 0

for path in sorted(Path(".").rglob("*.md")):
    if any(part in {"node_modules", ".git"} for part in path.parts):
        continue

    checked += 1
    data = path.read_bytes()
    if b"\x00" in data:
        errors.append(f"{path}: contains a NUL byte")
        continue

    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        errors.append(f"{path}: invalid UTF-8 ({exc})")
        continue

    for line_number, line in enumerate(text.splitlines(), start=1):
        stripped = line.lstrip()
        if (
            stripped.startswith("<<<<<<< ")
            or stripped == "======="
            or stripped.startswith(">>>>>>> ")
        ):
            errors.append(f"{path}:{line_number}: unresolved merge-conflict marker")

if errors:
    print("Documentation validation failed:", file=sys.stderr)
    for error in errors:
        print(f"- {error}", file=sys.stderr)
    raise SystemExit(1)

print(f"Documentation validation passed for {checked} file(s).")
PY
