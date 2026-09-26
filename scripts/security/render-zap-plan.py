#!/usr/bin/env python3
"""Render a private SEC-06 plan because ZAP does not expand variables in every job."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

NAMES = frozenset({
    "AIP_SECURITY_ZAP_TARGET",
    "AIP_SECURITY_ZAP_TARGET_REGEX",
    "AIP_SECURITY_ZAP_TENANT",
    "AIP_SECURITY_ZAP_COOKIE",
    "AIP_SECURITY_ZAP_CSRF_TOKEN",
    "AIP_SECURITY_ZAP_REPORT_DIR",
    "AIP_SECURITY_ZAP_REPORT_FILE",
})
TOKEN = re.compile(r"\$\{(AIP_SECURITY_ZAP_[A-Z0-9_]+)\}")
QUOTED = re.compile(r'"([^"\n]*)"')


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: render-zap-plan.py TEMPLATE PRIVATE_OUTPUT")
    template = Path(sys.argv[1]).read_text(encoding="utf-8")
    output = Path(sys.argv[2])
    if {match.group(1) for match in TOKEN.finditer(template)} != NAMES:
        raise SystemExit("SEC-06 plan variable inventory changed")
    values = {name: os.environ.get(name, "") for name in NAMES}
    if not all(values.values()):
        raise SystemExit("SEC-06 plan requires all authenticated scan values")

    def replace_quoted(match: re.Match[str]) -> str:
        value = match.group(1)
        if not TOKEN.search(value):
            return match.group(0)
        expanded = TOKEN.sub(lambda token: values[token.group(1)], value)
        return json.dumps(expanded, ensure_ascii=True)

    rendered = QUOTED.sub(replace_quoted, template)
    if TOKEN.search(rendered):
        raise SystemExit("SEC-06 plan contains an unexpanded variable")
    # The state directory is private and is removed by the scanner harness.
    # O_EXCL prevents reusing a previously generated plan or following a symlink.
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(rendered)


if __name__ == "__main__":
    main()
