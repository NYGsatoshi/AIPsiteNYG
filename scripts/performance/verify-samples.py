#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from common import PerformanceContractError, load_json, repository_root


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate generic PERF-02 measurement-envelope invariants.")
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--environment-contract", type=Path, default=repository_root() / "performance" / "environment.json")
    args = parser.parse_args()

    try:
        contract = load_json(args.environment_contract)
        results = load_json(args.results)
        measurement = contract.get("measurement")
        if not isinstance(measurement, dict):
            raise PerformanceContractError("environment contract missing measurement section")
        minimum = measurement.get("minimumSamples")
        if not isinstance(minimum, int) or minimum <= 0:
            raise PerformanceContractError("minimumSamples must be a positive integer")
        if results.get("warmupSamplesExcluded") is not True:
            raise PerformanceContractError("benchmark evidence must prove warm-up samples were excluded")
        measured = results.get("measuredSamples")
        if not isinstance(measured, int) or measured < minimum:
            raise PerformanceContractError(
                f"insufficient measured samples: expected at least {minimum}, got {measured!r}"
            )
        if results.get("environmentStable") is not True:
            raise PerformanceContractError("environment is unstable; PERF-02 never rounds instability to green")
        if results.get("benchmarkExitCode") != 0 or results.get("timedOut") is not False:
            raise PerformanceContractError("benchmark process failed or timed out")
        print(json.dumps({"passed": True, "measuredSamples": measured, "minimumSamples": minimum}, sort_keys=True))
        return 0
    except (PerformanceContractError, OSError, ValueError) as exc:
        print(f"PERF-02 measurement envelope failed: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
