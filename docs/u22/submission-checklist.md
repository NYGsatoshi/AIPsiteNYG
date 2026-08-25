# U-22 2026 submission checklist

Status: preparation template. Do not mark this document complete until the
final immutable submission baseline has passed its required checks.

## Submission record

| Field | Final value |
| --- | --- |
| Submission SHA | `[record immutable final SHA at freeze]` |
| Release identifier | `[record tag or protected release branch at freeze]` |
| Freeze date and time (JST) | `[record]` |
| Evidence owner | `[record]` |
| Demo environment | `[record test-only loopback or approved environment]` |
| Last verification date and time (JST) | `[record]` |

The SHA and release identifier must name the same immutable source tree.
Evidence from an earlier commit, a mutable branch tip, mocked responses, or a
different deployment is not final-baseline evidence.

## Product vertical slice

- [ ] Login is usable with the selected test or review account.
- [ ] Workspace selection is understandable; authorized Workspace creation is
  demonstrated if the selected journey creates one.
- [ ] Project creation uses the server-projected options, creates a Draft, and
  explicit activation opens the operational Project context.
- [ ] New Task clearly names its current Project and does not ask for raw
  internal identifiers.
- [ ] Task metadata, named Milestone and eligible Assignee choices where
  authorized, and validation/retry behavior use the canonical create flow.
- [ ] Goal, Deliverable, and Constraints are optional structured Brief fields
  whose entered values persist with the Task.
- [ ] Source scope shows the effective server-authorized Project policy or a
  permitted complete Task override. The UI does not imply source consumption.
- [ ] The advisory quality checklist evaluates Goal, Deliverable, Constraints,
  and effective source policy; it can focus missing Brief fields and never
  blocks creation solely because optional information is missing.
- [ ] Create is idempotent, duplicate-submit resistant, and followed by an
  authoritative Task detail view or safe recovery state.
- [ ] Task detail makes the current Task state, configured current phase, and
  available Activity understandable without inventing a percentage or history.
- [ ] Keyboard operation and the 320-pixel presentation are checked for the
  journey screens.

## Truthfulness boundary

- [ ] Demo narration and screenshots describe source scope as policy only.
- [ ] No material claims outbound Web retrieval, provider selection, file
  materialization, raw-source persistence, runtime output, or execution unless
  a separately approved implementation and evidence are present in the exact
  baseline.
- [ ] Current phase is described as the configured current Workflow Stage.
- [ ] Activity is described only as authorized records that already exist. It
  is not presented as durable phase-transition history.
- [ ] Any test fixture Activity is labelled synthetic presentation data and is
  not described as a user action, an execution result, or a transition record.
- [ ] Test-only seed data, credentials, ports, and Compose overlays are never
  represented as a production deployment.

## Final verification evidence

Record the exact command, environment, final SHA, result, and CI run or local
artifact link for every applicable gate. A skipped provider test, a license
preflight-only branch, or a mocked browser test cannot substitute for its
corresponding required real execution.

| Gate | Required result | Final evidence |
| --- | --- | --- |
| Backend Release build | Pass | `[record]` |
| Full backend tests | Pass with all skips explained | `[record]` |
| PostgreSQL tests and migration application | Pass against disposable PostgreSQL | `[record]` |
| EF pending-model check | No pending model changes | `[record]` |
| Angular unit tests | Pass | `[record]` |
| Angular production build | Pass | `[record]` |
| Frontend architecture and Syncfusion license guard | Pass | `[record]` |
| Storybook build, where required by current CI | Pass or documented non-gate exception | `[record]` |
| Pinned Linux Playwright | Pass | `[record]` |
| Required real-backend P0 acceptance | Pass against ASP.NET Core and PostgreSQL | `[record]` |
| Real Backend My Tasks acceptance | Pass | `[record]` |
| WPC security acceptance / applicable authorization checks | Pass | `[record]` |
| U-22 same-lineage journey | Pass against the real backend | `[record]` |
| Security/dependency checks | Pass or approved, documented exception | `[record]` |
| Compose configuration and chosen demo rehearsal | Pass | `[record]` |

## Security and boundary checks

- [ ] An unauthorized Tenant cannot create, read, or infer the selected
  Workspace, Project, or Task.
- [ ] An unauthorized Workspace or Project cannot be used through direct
  routes, stale browser state, or crafted create requests.
- [ ] Task Brief, source-policy reads and writes, Task detail, Activity, and
  task-related Files retain their existing server-side resource boundaries.
- [ ] Lost create permission, stale capability, malformed API success, invalid
  server response, and duplicate create have representative regression
  coverage.
- [ ] Cookie-authenticated unsafe requests retain CSRF protection and the
  idempotency boundary remains server-authoritative.
- [ ] No credential, Syncfusion license value, test secret, raw source content,
  or protected resource name leaks into logs, artifacts, or documentation.

## Demo and documentation readiness

- [ ] Deterministic test-only demo data is reproducible, if used.
- [ ] The demo can be repeated from a clean, isolated test stack.
- [ ] The presenter rehearsed the three-minute script on the frozen SHA.
- [ ] The demo shows a created Task truthfully and labels any synthetic
  Activity.
- [ ] Architecture, implementation, setup, inventory, limitations, and this
  checklist have been reviewed against the exact final source.
- [ ] The implementation summary truthfully discloses AI/Codex-assisted
  development and retains repository-owner responsibility for approval and
  submission claims.
- [ ] Third-party and repository-license review status is recorded in the
  inventory; commercial components have an approved entitlement path.

## Freeze decision

Do not write `U22_RELEASE_READY` until every applicable box above is checked,
all listed final evidence points to the exact submission SHA, and the known
limitations remain accurate. After freeze, permit only blocker fixes on the
submission baseline; record each such change by creating a new immutable
baseline and repeating the affected gates.
