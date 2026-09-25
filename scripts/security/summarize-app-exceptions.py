#!/usr/bin/env python3
"""Summarize exception types from failing SEC-04 app logs without copying request data."""

from __future__ import annotations

import collections
import re
import sys


# Compose adds `app-1 |` before each application log line.
EXCEPTION_TYPE = re.compile(r"(?:^|\|)\s*([A-Za-z_][\w.]*(?:Exception|Error))\s*:")


def main() -> None:
    counts: collections.Counter[str] = collections.Counter()
    other_counts: collections.Counter[str] = collections.Counter()
    after_unhandled = 0
    for line in sys.stdin:
        if "Unhandled request exception." in line:
            after_unhandled = 12
            continue
        match = EXCEPTION_TYPE.search(line)
        if match is None:
            if after_unhandled:
                after_unhandled -= 1
            continue
        if after_unhandled:
            counts[match.group(1)] += 1
            after_unhandled = 0
        else:
            other_counts[match.group(1)] += 1

    for name, count in counts.most_common(30):
        print(f"unhandled {name}: {count}")
    for name, count in other_counts.most_common(30):
        print(f"logged {name}: {count}")


if __name__ == "__main__":
    main()
