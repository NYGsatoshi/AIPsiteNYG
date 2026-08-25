# U-22 known limitations

This is the active submission limitation record. It favors a smaller truthful
demonstration over a claim that planned runtime or workflow semantics exist.

## Source scope is policy only (Issue #357 remains open)

The current source-scope implementation records server-authorized eligibility
for Web and Project files through a Project default and an optional complete
Task override. It includes an immutable policy-snapshot foundation and a
runtime port whose current implementation is unavailable and performs no I/O.

The U-22 baseline does not implement or claim:

- outbound Web retrieval, crawling, or search;
- source inventory, URL selection, or provider selection;
- Project-file enumeration, materialization, or raw file-content persistence;
- execution workers, prompts, credentials, model/provider calls, or runtime
  output; or
- an approved Web execution/provider/egress contract.

An explicit canonical specification promotion and approved execution/egress
contract are required before any later change can represent those behaviors.

## Task phase and Activity are bounded (Issue #369 remains open)

Task detail can show current state, configured current Workflow Stage, and
existing authorized Activity. This baseline does not implement or claim a
durable Task execution-state model for Failed, Needs input, target stage,
historical stage transitions, generated phase history, or percentage progress.

Activity is not an execution log. An empty Activity result is valid. A
test-fixture Activity record, if used in the demo, is explicitly synthetic
presentation data and not evidence of an executed action or phase transition.

## Canonical Task-create reconciliation remains open (Issue #410)

The current Project-to-New-Task flow is usable under the repository's current
contract, but Issue #410 is not closed. The external canonical requirements
still need an explicit decision for the unassigned Task/TargetGroup case and
the public enum representation. The submission should demonstrate the current
flow without claiming that this reconciliation is complete.

## Submission fixture is not production data

The optional U-22 fixture is limited to the Test environment plus explicit
browser-smoke seed opt-in and an isolated loopback Compose overlay. It has
deterministic test credentials and must not be exposed as a shared service,
deployed environment, or production seeding mechanism. Its policy flags and
synthetic Activity only support an honest UI demonstration.

## Evidence and environment limits

- A successful mocked Angular or Playwright run does not prove the ASP.NET
  Core, CSRF, authorization, or PostgreSQL integration path.
- Conditional PostgreSQL tests skipped because
  `POSTGRES_TEST_CONNECTION_STRING` is unavailable are not provider evidence.
- Licensed Compose/browser runs require a protected Syncfusion license. A
  preflight-only or license-unavailable path is not a successful real-backend
  run.
- Final release readiness requires exact-SHA evidence for the gates listed in
  [submission-checklist.md](submission-checklist.md). This document alone does
  not certify a release.

## Broader product and operational limits

The repository is suitable for the bounded U-22 demonstration after its final
gates pass, not a claim of turnkey production readiness. Active documentation
records additional limitations such as partial invite onboarding, deployment
and backup/restore evidence gaps, and areas of the broader portal that remain
placeholder or partially implemented. The final submission narrative should
stay on the verified Workspace, Project, Task, Brief, source-policy,
checklist, state, phase, and Activity slice.
