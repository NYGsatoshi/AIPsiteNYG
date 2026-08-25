# U-22 implementation summary

This summary describes the submission path in the repository. It does not
close open issues or promote a planned external contract to an implemented
capability.

## Included vertical slice

| Area | Current submission-path behavior | Qualification |
| --- | --- | --- |
| Authentication and tenant context | Cookie-authenticated browser requests, session validation, CSRF boundary, and tenant-aware persistence are present. | Production deployment hardening remains an operational concern. |
| Workspace creation (#408) | Server-authorized, idempotent Workspace creation is available from the Workspace flow and activates through the authorized selection boundary. | Browser visibility is presentation only; server authorization is authoritative. |
| Project creation and activation (#409) | Project creation uses server-owned options and creates a Draft. Explicit activation opens the operational Project context. | Create and activation are intentionally separate commands. |
| Task Brief (#350) | Goal, Deliverable, and Constraints are nullable Task-specific structured fields and appear in the Task create/detail flow. | Project Description is not silently used as a Brief default. |
| Task create (#410) | The Project-aware canonical create flow exposes server-projected options, optional metadata/Brief, named eligible choices, CSRF, idempotency, and authoritative recovery. | Issue #410 remains open for canonical-spec reconciliation described below. |
| Quality checklist (#354) | An advisory review covers Goal, Deliverable, Constraints, and effective source policy. Missing Brief actions focus existing fields; incomplete optional information does not block Create. | It adds no API, persistence, required Brief field, runtime, or source provider. |
| Source policy (#357 foundation) | A Project default and permitted complete Task override represent Web and Project-files eligibility. Task detail can show policy metadata. | Policy only; no source acquisition or execution is claimed. |
| Task state and phase (#342, #369 foundation) | Task detail shows current Task state and configured current Workflow Stage as its current phase. | No Task Failed category or fabricated percentage is introduced. |
| Activity (#369 foundation) | Task detail can read authorized, bounded existing Activity records separately from the phase. | No production Task Activity writer, durable phase-transition history, or synthetic history inference exists. |

## Important implementation boundaries

- New Task does not accept raw internal IDs, source identifiers, URLs, provider
  configuration, credentials, prompts, or execution instructions.
- A fail-closed `false` / `false` source policy is still a valid effective
  policy, not missing data.
- Only authorized Project managers may select the current initial primary
  Assignee or a complete Task source-policy override. Other authorized Task
  creators can create an unassigned Task that inherits Project policy.
- The Task create transaction does not start execution, make an outbound
  request, materialize files, persist raw source content, or create a runtime
  result.
- Activity failure does not erase current phase, and current phase is not
  derived from Activity count or ordering.

## Test-only demonstration fixture

When a selected baseline includes the fixture, [demo-data.md](demo-data.md)
is the authoritative setup and safety record. It supplies a deterministic
synthetic Project and Task only in the Test environment with explicit
browser-smoke seed opt-in and a loopback-only Compose overlay. Its stored
Brief, policy, current phase, and one labelled synthetic Activity record make
the presentation repeatable; they do not evidence a real user action, source
consumption, runtime execution, or phase transition.

## Open issue boundaries

### Issue #357: source scope remains non-closing

The repository has a policy and immutable snapshot foundation, plus an
unavailable no-I/O runtime port. It intentionally lacks an approved canonical
Web execution/provider and egress contract. No U-22 screen or documentation
may imply that Web retrieval, project-file reading, provider execution, or raw
source persistence occurred.

### Issue #369: semantics remain non-closing

The current product can show configured current phase and existing Activity.
It does not contain a canonical durable Task execution-state model for Failed,
Needs input, target phase transitions, historical phase sequence, or inferred
percentage. Those semantics must not be fabricated merely to close the issue.

### Issue #410: external contract reconciliation remains open

The repository's canonical Project-to-New-Task flow is substantially
implemented and tested. The issue remains open because current external
canonical requirements still need reconciliation for the unassigned
Task/TargetGroup case and public enum representation. Do not close #410 just
because its merged UI and server flow work under the current repository
contract.

## Evidence posture

Focused unit, static browser, and production-build checks are useful evidence,
but they do not replace real ASP.NET Core/PostgreSQL execution. The final
baseline must record exact-head PostgreSQL, real-backend P0, authorization, and
U-22 journey evidence in [submission-checklist.md](submission-checklist.md).

## Development process disclosure

The U-22 preparation was performed under repository-owner direction with
AI/Codex-assisted development. Suggested changes and documentation were
reviewed against current source and verification evidence; the repository
owner remains responsible for approval, credentials, release decisions, and
all submission claims.
