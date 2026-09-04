# Performance contract (PERF-01 / Issue #592)

This directory is the versioned contract for Performance CI. It defines what is measured, the deterministic workload shapes, the metrics collected, and which results may block CI. It intentionally does **not** run k6, Lighthouse, browser load tests, or product-code performance changes.

JSON is used so validation can run with the Python standard library already available in CI. The parser rejects non-standard numeric constants such as `Infinity` and `NaN` and produces a deterministic summary.

## Inventory baseline

The initial inventory was taken from `main` at `79efe27722e3b9c2ddc2d6d5eed5010299e4df32` on 2026-09-04. Routes in `scenarios.json` are backed by current controller or Angular route source; no route is added from a future plan alone.

The scenario matrix covers authentication/session bootstrap, Workspace and Project list/detail, Task list/detail/My Tasks, Kanban, Gantt, File metadata/list/download preflight, Conversation/message list, Notification/Announcement list, one resettable mutation, and SignalR as a separate realtime metric family.

## Dataset profiles

`datasets.json` defines deterministic `small`, `medium`, and `large` seed manifests. Counts are workload shapes for repeatable testing, not product-capacity promises. The focus cardinalities deliberately exercise different contracts:

- `small`: mostly one or two pages;
- `medium`: sustained multi-page list and Gantt reads;
- `large`: deep pagination and a Gantt graph above the historical PR06 full-snapshot envelope.

The list defaults recorded from current source are Project/Task/My Tasks `50`, Files/Conversations/Notifications/Announcements `20`, Messages `50`, and Kanban `MaxCards=300` with an explicit maximum of `500`.

### Gantt contract and current implementation mismatch

Issue #270 is closed as completed and defines cursor pagination with default page size `100`, maximum page size `200`, stable ordering, virtual scrolling, and a bounded client cache. It also states that any future Project-wide hard limit is a separate deployment-configurable, load-tested owner decision.

Current `main` does not match that closed-issue contract: `GET /api/projects/{projectId}/gantt` still has no cursor/page-size input, and the source still enforces the temporary PR06 full-snapshot envelope of 500 combined items and 2,000 dependencies. Active PR06 verification documentation also still describes large-project delivery as follow-up work.

PERF-01 therefore records both facts without silently choosing the stale implementation as a new product contract:

- canonical PERF dataset pagination: #270 default `100`, max `200`;
- Project-wide hard limit: none approved by #270;
- observed 500/2,000 values: implementation-mismatch evidence only, **never** dataset capacity limits;
- the `large` profile intentionally exceeds both historical temporary values. A future performance runner must fail closed rather than shrinking the fixture or treating a rejected/missing sample as a performance success until the product implementation and #270 status are reconciled.

## Metrics and gate classes

API scenarios declare p50/p95/p99 latency, error rate, and throughput. Relevant list/load paths also declare query count, total DB time, and optional slow-query evidence. Browser-backed scenarios declare navigation/load/interaction metrics. Kanban/Gantt and realtime scenarios reserve runtime RSS/heap/GC/CPU/DB-connection metrics for extended runs. SignalR uses its own realtime metric family.

Gate classes are:

- `hard-ceiling`: an existing absolute product ceiling; violation blocks immediately;
- `relative-regression`: compare with an approved measured baseline identity;
- `trend-only`: record but do not block while variance/baselines mature;
- `extended-only`: collect only in nightly or explicitly requested runs.

The initial contract does not invent millisecond SLOs. Latency and DB/runtime values remain trend/extended-only until repeatable measurements establish baselines. The only initial hard ceiling is the existing Angular production initial-bundle `maximumError` of `1.02MB` from `frontend/angular.json`.

A relative-regression budget is invalid unless it names an approved baseline identity, SHA, date, evidence, and comparison rule. A budget without rationale/baseline metadata is invalid. `Infinity`, `NaN`, missing samples, timeouts, effectively-disabled thresholds, and average-only latency gates are forbidden by policy. Tiny GitHub-hosted runner deltas are not blocking until a stable relative envelope is explicitly approved.

Any PR that relaxes a blocking budget must carry reason, before evidence, and after evidence in the change/review record. Do not change a numeric ceiling only to make CI green.

## Ownership boundaries

- #74: DB-side pagination ownership for large list reads (historically closed as not planned, retained as the performance-boundary reference).
- #78: N+1/query-count ownership for list/read projections (historically closed as not planned, retained as the query-shape boundary reference).
- #270: large-project Gantt pagination/virtualization contract and its current source/status reconciliation.

PERF-01 owns only the test contract and validation. It does not absorb product-code performance remediation.

## Validation

Run the fail-closed validator:

```bash
python3 scripts/ci/verify-performance-contract.py
```

Run its regression tests:

```bash
python3 -m unittest discover -s tests/ci -p 'test_performance_contract.py'
```

Validation rejects duplicate scenario IDs, unknown metrics/gates, missing/disabled budget metadata, relative budgets without baseline identity, invalid pagination/cardinality math, a Gantt page size above #270's maximum, or a `large` Gantt profile that has been silently collapsed back into the old temporary full-snapshot envelope.
