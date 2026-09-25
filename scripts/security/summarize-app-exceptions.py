#!/usr/bin/env python3
"""Summarize exception types from failing SEC-04 app logs without copying request data."""

from __future__ import annotations

import collections
import re
import sys


# Compose adds `app-1 |` before each application log line.
EXCEPTION_TYPE = re.compile(r"(?:^|\|)\s*([A-Za-z_][\w.]*(?:Exception|Error))\s*:")
STACK_METHOD = re.compile(r"\bat\s+([A-Za-z_][\w.+`<>]+)\(")


def main() -> None:
    counts: collections.Counter[str] = collections.Counter()
    other_counts: collections.Counter[str] = collections.Counter()
    origins: collections.Counter[tuple[str, str]] = collections.Counter()
    first_frames: collections.Counter[tuple[str, str]] = collections.Counter()
    after_unhandled = 0
    pending_exception: str | None = None
    fallback_method: str | None = None
    frames_remaining = 0
    for line in sys.stdin:
        if "Unhandled request exception." in line:
            if pending_exception and fallback_method:
                origins[(pending_exception, fallback_method)] += 1
            pending_exception = None
            fallback_method = None
            after_unhandled = 12
            continue
        match = EXCEPTION_TYPE.search(line)
        if match is None:
            if pending_exception and frames_remaining:
                frame = STACK_METHOD.search(line)
                if frame:
                    method = frame.group(1)
                    if fallback_method is None:
                        fallback_method = method
                        first_frames[(pending_exception, method)] += 1
                    if method.startswith("AipPortal."):
                        origins[(pending_exception, method)] += 1
                        pending_exception = None
                frames_remaining -= 1
                if not frames_remaining and pending_exception:
                    origins[(pending_exception, fallback_method or "no-stack-frame")] += 1
                    pending_exception = None
            if after_unhandled:
                after_unhandled -= 1
            continue
        if after_unhandled:
            name = match.group(1)
            counts[name] += 1
            pending_exception = name
            fallback_method = None
            frames_remaining = 35
            after_unhandled = 0
        else:
            other_counts[match.group(1)] += 1

    for name, count in counts.most_common(30):
        print(f"unhandled {name}: {count}")
    for name, count in other_counts.most_common(30):
        print(f"logged {name}: {count}")
    if pending_exception:
        origins[(pending_exception, fallback_method or "no-stack-frame")] += 1
    for (name, method), count in origins.most_common(30):
        print(f"origin {name} {method}: {count}")
    for (name, method), count in first_frames.most_common(30):
        print(f"first-frame {name} {method}: {count}")


if __name__ == "__main__":
    main()
