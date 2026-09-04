#!/usr/bin/env python3
"""Verify that a Grype JSON report was produced from the exact canonical SBOM file."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


class SourceBindingError(ValueError):
    pass


def fail(message: str) -> "NoReturn":
    raise SourceBindingError(message)


def read_json(path: Path) -> dict[str, Any]:
    if not path.is_file() or path.stat().st_size == 0:
        fail(f"Grype report is missing or empty: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        fail(f"Grype report is not valid UTF-8 JSON: {path}: {exc}")
    if not isinstance(value, dict):
        fail("Grype report root must be a JSON object")
    return value


def command(args: argparse.Namespace) -> None:
    report_path = Path(args.report).resolve()
    sbom_path = Path(args.sbom).resolve()
    if not sbom_path.is_file() or sbom_path.stat().st_size == 0:
        fail(f"canonical SBOM is missing or empty: {sbom_path}")

    report = read_json(report_path)
    source = report.get("source")
    if not isinstance(source, dict):
        fail("Grype report source metadata is missing")

    source_type = source.get("type")
    if source_type != "sbom-file":
        fail(
            "Grype report was not produced from the canonical SBOM file: "
            f"source.type={source_type!r}"
        )

    target = source.get("target")
    if not isinstance(target, str) or not target.strip():
        fail("Grype SBOM source target is missing")
    target_path = Path(target).resolve()
    if target_path != sbom_path:
        fail(
            "Grype report SBOM source mismatch: "
            f"report={target_path}, expected={sbom_path}"
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True)
    parser.add_argument("--sbom", required=True)
    return parser


def main() -> int:
    try:
        command(build_parser().parse_args())
    except SourceBindingError as exc:
        print(f"SEC-10 Grype source binding failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
