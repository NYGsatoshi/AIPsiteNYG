#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / "scripts/ci/evaluate-governance-pr-review.py").read_text(encoding="utf-8")

required = (
    "PARENT_GATE_ID = \"GOV-GATE-EXT-APPROVAL-001\"",
    "required_check_contract.py",
    "required_check_parent.py",
    "governance/required-checks.json",
    "default_branch",
    "evaluate_from_trusted_parent",
    "load_required_check_registry",
    "GH_TOKEN",
    "REPOSITORY",
)

missing = [fragment for fragment in required if fragment not in SOURCE]
if missing:
    raise SystemExit(f"trusted GOV-06 review wiring is incomplete: {missing}")

if "if decision[\"state\"] != \"success\":" not in SOURCE:
    raise SystemExit("review denial must short-circuit before GOV-06 network evaluation")

if "GOV-06 exact-head required checks are pending; merge remains blocked." not in SOURCE:
    raise SystemExit("pending GOV-06 evidence must remain merge-blocking")

print("Trusted review -> GOV-06 wiring invariant passed.")
