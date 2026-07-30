# TASK-V1-PR06 Canonical Gantt implementation and verification ledger

This document records the implementation-start audit for TASK-V1-PR06. It is
also the living implementation and verification ledger. The initial
classification is retained as evidence that the specification/current-main
comparison happened before the first commit. Any item marked `Pending`,
`Not run`, `Unverified`, or qualified as pre-final-HEAD must not be treated as
passing.

## Scope and stopping point

PR06 upgrades the existing Project Detail Schedule tab and
`GET /api/projects/{projectId}/gantt` around the shared canonical WorkItem
model. It must not replace that model with a Gantt-owned database, route, or
vendor model.

This work stops after the PR06 Go/No-Go report. It does not include:

- PR07 notification, digest, or realtime finalization
- PR08 integrated cutover
- merge of the PR06 pull request
- automatic scheduling or cascading date movement
- Critical Path, baseline comparison, resource leveling, or automatic
  workload balancing

## Start identity

| Field | Initial value |
| --- | --- |
| Repository | `NYGsatoshi/AIPsiteNYG` |
| Branch | `task/v1-pr06-gantt-adapter` |
| Main start SHA | `0a8a1f58b8365e9ffc54daafceca99864ae5f63f` |
| Branch start SHA | `0a8a1f58b8365e9ffc54daafceca99864ae5f63f` |
| PR05 final PR HEAD | `5817fefda7e6ff70fe617c4ebdbac87ace8fe5f9` |
| PR05 merge commit | `0a8a1f58b8365e9ffc54daafceca99864ae5f63f` |
| Canonical specification revision | `20aa5a2e015ae8fb68e5ba2b257a416dfcad5c3f` |
| PR06 prompt blob | `a18719099d363a02fc0e9ea877a1909ff7d29daf` |
| PR06 prompt introducing commit | `b4fd4d6301a9c0d3197d921118e25d7bf8833f73` |
| Code-bearing HEAD | `ab9a260dd4517d34a2500d5e76369ba241b504ee` |
| Final documentation HEAD | Pending |
| PR number | `#259` |
| Draft PR | Open |
| Mergeable | Pending |
| Merged | No |
| Merge performed | No |

The specification worktree was inspected at the revision above. It remained a
reference source only and is not an intended PR06 change.

## Main post-PR05 Gate

All four required runs were completed `success` for the exact actual-main SHA
`0a8a1f58b8365e9ffc54daafceca99864ae5f63f`. These are kickoff gates only;
they are not evidence for the future PR06 final HEAD.

| Workflow | Event | Status | Conclusion | Head SHA | Run |
| --- | --- | --- | --- | --- | --- |
| Documentation CI | `push` | `completed` | `success` | `0a8a1f58b8365e9ffc54daafceca99864ae5f63f` | [30534541849](https://github.com/NYGsatoshi/AIPsiteNYG/actions/runs/30534541849) |
| CI | `push` | `completed` | `success` | `0a8a1f58b8365e9ffc54daafceca99864ae5f63f` | [30534541890](https://github.com/NYGsatoshi/AIPsiteNYG/actions/runs/30534541890) |
| Code Quality | `push` | `completed` | `success` | `0a8a1f58b8365e9ffc54daafceca99864ae5f63f` | [30534541948](https://github.com/NYGsatoshi/AIPsiteNYG/actions/runs/30534541948) |
| npm Security Audit | `push` | `completed` | `success` | `0a8a1f58b8365e9ffc54daafceca99864ae5f63f` | [30534542164](https://github.com/NYGsatoshi/AIPsiteNYG/actions/runs/30534542164) |

Initial kickoff result:

- TASK-V1-PR05 post-merge recovery: Complete
- TASK-V1-PR06 kickoff: Go

## Canonical sources audited

The implementation prompt at
`docs/specs/aip-core-v4/12-implementation-kickoff/task-v1-pr06-gantt-adapter-prompt.md`
in `NYGsatoshi/AIPsiteNYGspec` is the primary source.

The audit also covered:

- Task/work management and planning scope
- the closed Workspace Task Messaging owner decisions
- permission, data-access, and safe-error requirements
- EF Core/PostgreSQL design
- API error, realtime event, SignalR group, Outbox, and reconnect contracts
- Task/work planning API and owner-decision implementation mappings
- Task/work planning acceptance documents
- component adoption and frontend migration mappings
- implementation-side PR02 and PR05 task records and PR05 verification
- the current Planning application service, repository, controller, Project
  Detail facade, adapter contracts, feature flags, and realtime foundations

Where older event-name tables conflict with the newer catalog, the canonical
event family is `Projects.TaskChanged.v1` and `Projects.ProjectChanged.v1`.
All owner-decision items named by the PR06 prompt are closed; they are not
reopened here.

## Initial gap audit summary

### Complete

The following reusable foundations exist on the main start SHA:

- A shared canonical `TaskItem`/WorkItem source of truth exists. It includes
  WorkItem kind, parent relationship, canonical planned dates, progress,
  workflow stage, blocked state, primary assignee, and version fields.
- No separate Gantt-owned authoritative schedule or progress table exists.
- Canonical planning dates are represented as `DateOnly`; `DeadlineAt` remains
  a separate timestamp field.
- The shared parent-derivation utility can derive parent planned bounds and
  progress from canonical direct children.
- Workspace timezone persistence and the canonical
  `ITaskWorkspaceTimeZoneResolver` exist, with tenant timezone and UTC fallback.
- The existing route is `GET /api/projects/{projectId}/gantt`; no separate
  Gantt route is needed.
- Project Detail already owns the Schedule tab; no parallel route is needed.
- Canonical Task dependency persistence and existing add/remove routes exist.
  Their service already rejects non-FS authoring, self-dependency,
  cross-Project dependency, duplicate dependency, and cycles.
- Shared audit, Task invalidation, transactional command, feature-flag, and
  realtime/catch-up foundations exist and can be reused.

These foundation statements do not mean the PR06 projection, commands, UI, or
acceptance tests are complete.

### Partially complete

- The current Gantt snapshot performs project view authorization and returns
  project, milestone, task, assignment, and dependency data, but only through
  the legacy compact DTO.
- Deleted projects are filtered by the repository, but archived/read-only
  behavior is not expressed in the snapshot contract or Gantt command policy.
- The current repository projection is set-based. Its data path executes four
  queries when there are no Tasks and five when Tasks are present, because
  assignments are loaded in one batched query. This is a static code inventory,
  not an end-to-end measured query count.
- Task assignments are batched, and cancellation tokens are propagated through
  the current repository queries, but the result graph is unbounded.
- Canonical Task responses and PR02/PR05 commands already use version fields,
  but the Gantt snapshot does not expose the required project, workflow,
  calendar, Task, and dependency versions.
- The general `PATCH /api/tasks/{taskId}` Task-details command can currently
  write planned dates and progress with optimistic concurrency and shared
  parent validation. It owns unrelated fields as well, so it is not the
  schedule-only or progress-only PR06 contract.
- Existing Task commands use audit and transactional invalidation foundations.
  Existing dependency add/remove commands audit mutations, but their complete
  PR06 Outbox, safe-error, and version behavior is not established.
- A safe typed error envelope exists for newer Task commands, but the current
  Gantt endpoint and legacy dependency controller paths do not use it.
- The vendor-neutral adapter shell and adapter state vocabulary exist, but the
  Gantt contract contains only labels, milestones, a timezone string, and a
  global read-only flag.
- The existing semantic Schedule list is keyboard-readable, but it has no
  authorized editing forms, rollback/conflict workflow, dependency actions, or
  purpose-built mobile projection.
- Project Detail already has realtime invalidation, catch-up, stale-response,
  revocation-clear, and active-interaction patterns for PR05 Kanban. Those
  patterns are not wired to Schedule/Gantt.
- The central frontend feature-flag service exists, but `tasks.ganttV1` does
  not.

### Missing

- A bounded vendor-neutral Gantt snapshot contract with `scheduledItems`,
  `unscheduledItems`, milestones, dependencies, structured warnings, and
  permissions
- Project, workflow, and supported calendar version fields in the snapshot
- Workspace timezone and available working-calendar summary in the response
- Canonical WorkItem projection fields: kind, parent ID, canonical planned
  dates, milestone date, derived-progress marker, workflow-stage metadata,
  priority, blocked state, canonical primary assignee, version/etag, per-item
  schedule permissions, and warnings
- Explicit parent-derived bars and direct-edit denial
- Explicit unscheduled Task projection without guessed dates
- Milestone zero-duration projection and required-date enforcement
- Structured warning contracts for `DEPENDENCY_VIOLATION`,
  `MISSING_ACTIVE_PLANNED_END`, `PARENT_DERIVED`,
  `LEGACY_DEPENDENCY_TYPE`, `MILESTONE_DATE_REQUIRED`, and `UNSCHEDULED`
- Dependency editability, legacy non-FS read-only inventory, versions where
  required, and warning projection
- Dedicated `PATCH /api/tasks/{taskId}/schedule`
- A canonical schedule-only request with nullable dates and required
  `expectedVersion`
- Dedicated or safely reused `PATCH /api/tasks/{taskId}/progress` semantics
  that own only progress and enforce leaf/Milestone/completion rules
- Command responses that return non-blocking warnings without date cascade
- Gantt-specific authoritative-refetch results for stale conflicts
- Gantt command audit plus Task/Project invalidation in the same transaction
  for schedule, progress, and dependency mutations
- `tasks.ganttV1` rollout and maintained disabled compatibility projection
- A typed Project Detail Schedule view model; the current HTTP response is
  `unknown`
- Direct date editing, leaf progress editing, FS dependency add/remove,
  schedule clear, Milestone edit, and unscheduled movement
- Pointer and accessible form/grid alternatives feeding the same canonical
  edit intent
- Focus trap, cancel-without-command, logical focus restoration, and safe
  diagnostic retention
- Loading, ready, empty, permission-denied, error, conflict, rollback, and
  degraded behavior in the actual Schedule workflow
- Purpose-built 320 px mobile ordered schedule, Milestone, unscheduled,
  hierarchy, dependency, and warning sections
- Lazy Gantt vendor loading and PR06 architecture checks preventing vendor
  types and imports from leaking into feature code
- Schedule-specific realtime stale/dedup behavior, active-edit conflict,
  reconnect refetch, revocation clear, and degraded HTTP/manual refresh
- Focused `Scope=TaskV1PR06` backend tests
- PR06 Angular, adapter, architecture, accessibility, and mocked-browser tests
- A real Angular + ASP.NET Core + PostgreSQL + cookie/CSRF PR06 browser scenario
- PR06 final documentation, SQL/query evidence, hosted gates, Qodana triage,
  and review-thread evidence

### Incorrect

The following current behaviors conflict with the PR06 canonical target and
must be replaced only within PR06 scope:

- `PlanningController` maps ordinary Gantt failures to a generic HTTP 400
  instead of separating 401, 403, safe 404, 409, and validation errors.
- The snapshot uses legacy `startDate`/`dueDate` naming and omits canonical
  planning semantics.
- The current Gantt service computes "today" from UTC rather than the canonical
  Workspace timezone resolver.
- Milestone due date is nullable in the current snapshot, and the response does
  not state zero-duration semantics.
- Parent dates and progress are not projected from the shared derivation
  algorithm.
- Undated Tasks remain in one generic Task list instead of an explicit
  unscheduled section.
- The current Gantt Task DTO returns an assignee list instead of the canonical
  primary-assignee summary required by PR06.
- All dependency types are returned without editable/read-only classification
  or a `LEGACY_DEPENDENCY_TYPE` warning.
- The frontend parses the response from `unknown`, reduces Tasks to
  `{ id, label }`, displays `"project timezone unavailable from API"`, and
  hard-codes the Schedule projection as read-only.
- The current repository loads every matching project Task and dependency
  without a maximum result bound.
- Existing dependency controller paths use generic 400 mapping. The dependency
  delete route does not establish that the nested Task ID is part of the
  authorization/integrity decision.

### Unverified

These items require implementation or executable evidence before a status can
be assigned:

- exact archived-Project read-only and safe-rejection behavior
- revoked Workspace membership and authorization-revocation behavior
- cross-Tenant and cross-Project non-disclosure for every snapshot and command
- duplicate-row absence across canonical hierarchy and Milestone projections
- Project/workflow/calendar stale-version behavior
- complete leaf, parent, Stage, Review, Done, Cancelled, and Milestone progress
  rules under concurrent mutation
- atomic rollback of persistence, audit, and Outbox on a failed save
- preservation of `DeadlineAt` across every PR06 mutation
- generated PostgreSQL query count including authorization and timezone
  resolution
- generated SQL and any justified `EXPLAIN`
- empty migration apply, upgrade from PR05, additive down behavior, pending
  migrations, and pending model changes
- whether PR06 requires a new migration at all
- dark/light theme, density, reduced-motion, and 320 px behavior
- actual Gantt bundle laziness and initial-bundle impact
- exact final-HEAD local and hosted test results
- real-backend cookie-auth, CSRF, persistence, conflict, revocation, and
  SignalR-degraded behavior
- Qodana findings and unresolved review-thread count

No canonical working-day or holiday entity/service was found in the current
implementation. PR06 must return only the available canonical summary and
timezone information, must not invent holidays, and must record this limitation
in the final evidence.

### Out of scope

- PR07 Notifications, digest, or realtime finalization
- PR08 integrated cutover
- automatic scheduling or cascading movement of predecessor/successor dates
- Critical Path
- baseline snapshots or comparison
- Resource Leveling or automatic workload balancing
- cross-Project dependencies or Task movement
- SS, FF, or SF authoring
- dependency lag or lead
- personal or recurring Tasks
- Calendar/Scheduler/school-timetable or attendance behavior
- multiple Boards, timesheet inference, or portfolio management
- changing PR04 My Tasks into a Gantt view
- changing package/license policy

## Working-tree gap reconciliation

This section classifies the current working tree after implementing the
confirmed PR06 deltas. It does not replace the kickoff classifications above
or claim final acceptance.

### Complete in the working tree

- The existing `GET /api/projects/{projectId}/gantt` route returns one
  deterministic vendor-neutral projection over canonical Tasks, compatibility
  Milestones, and canonical `TaskDependency` records.
- The projection includes Project/Workflow versions, supported Calendar
  version (`null` when unsupported), actual Workspace timezone, explicit
  calendar limitations, scheduled/unscheduled collections, hierarchy,
  zero-duration Milestones, derived parent values, primary assignee summary,
  Stage/priority/Blocked state, warnings, row versions, and permissions.
- Parent derivation considers only direct, non-deleted canonical Task-kind
  children. Milestones and non-Task rows cannot turn a Task into a derived
  parent or affect its dates/progress.
- The repository rejects more than 500 items counted as canonical Task-kind
  WorkItems plus canonical Milestones before loading rows, and rejects more
  than 2,000 dependencies; it never emits a partial snapshot. The same item
  count gate is used by snapshot, schedule, progress, and dependency paths.
  It rechecks the combined bound after reading rows to close the
  count-then-read race. Those numbers remain provisional pending the owner
  decision below.
- Schedule/progress commands own only their respective canonical fields,
  require optimistic versions, preserve `DeadlineAt`, allow Task schedule
  clear, enforce leaf/parent/Done/Cancelled/Milestone rules, and return
  non-blocking warnings without automatic date movement.
- The maintained compatibility Milestone update route requires a positive
  expected version, preserves the required-date invariant, and maps stale
  revisions to safe HTTP 409.
- Schedule JSON requires both nullable planned-date keys. Progress JSON rejects
  an omitted progress value. Dependency JSON requires predecessor and type,
  accepts canonical string `FinishToStart`, and rejects unknown members such as
  lag or lead.
- Existing PR02 dependency routes now require the successor version, author
  Finish-to-Start only, keep legacy non-FS rows read-only, reject unsafe
  neighbors/cycles/duplicates/self edges, and do not move dates. Bounded reads
  filter to active same-Project canonical Task endpoints, while parent-edge
  date warnings use canonical derived parent dates.
- Visible dependency rejections create metadata-safe audit records. Shared
  Project revision advancement makes a concurrent Task-delete/dependency-add
  race fail atomically; PostgreSQL evidence confirms no stale edge commits.
- Schedule, progress, dependency add/remove, audit entries, version advancement,
  and Task/Project Outbox invalidations share the command transaction. Failed
  saves clear tracked command state; PostgreSQL tests exercise atomic rollback.
- The shared terminal-parent invariant rejects subtask creation under a
  Done/Cancelled parent, rejects reopening a terminal child while its parent is
  terminal, and allows Done parent completion only when every direct canonical
  Task child is terminal and derived progress is 100. An all-cancelled child
  set derives 0 and is rejected. Review override completion applies the same
  guard, while child restore/delete beneath a terminal parent are rejected
  until the parent is reopened.
- PR06 routes map authentication, authorization, safe not-found, validation,
  and concurrency failures to typed safe envelopes rather than a generic 400.
- Request cancellation propagates. Unexpected snapshot exceptions return a
  safe HTTP 500 `GANTT_REQUEST_FAILED` envelope.
- `AipGanttContract` and feature models are vendor-neutral. Syncfusion Gantt is
  lazy, and feature code contains no Syncfusion record/event/enum/selector
  contract.
- The existing Project Detail Schedule tab supplies permission-gated schedule,
  progress, dependency, clear/unscheduled, warning, accessible form, focus,
  rollback/conflict, mobile-list, manual-refresh, and compatibility-flag
  behavior without adding a route or parallel data store.
- After a 409 rollback and authoritative refetch, preserved safe intent is
  exposed through explicit Retry-against-latest and Discard actions.
- Schedule reconciliation treats HTTP as authoritative, coalesces stale or
  duplicate invalidations, queues refetch during an edit, reauthorizes after
  reconnect, clears protected state on revocation, and preserves HTTP actions
  in degraded realtime mode.
- A denied realtime Project subscription synchronously clears both Kanban and
  Gantt protected projections and advances authorization/load/request
  generations before authoritative HTTP revalidation, so stale in-flight
  responses cannot restore protected data.

### Partially complete

- The runtime has an authoritative Workspace timezone but no canonical
  working-day or holiday service. The response truthfully returns an empty
  `workingDays` collection, `holidaysAvailable=false`, `calendarVersion=null`,
  and limitations. It does not infer weekends or holidays.
- Backend, Angular, architecture, license-policy, bundle, mocked-browser, and
  raised-heap Storybook commands have local evidence below. Exact final-HEAD
  and hosted evidence is still required.
- Storybook succeeds only with an explicitly increased 4 GB Node heap in the
  local environment. The required exact default command exhausted its 2 GB
  heap and is not counted as passing.

### Missing

- Owner approval of the canonical numeric graph limits and overflow behavior
- Final documentation HEAD
- Licensed exact-final-HEAD real-backend browser evidence
- Exact-final-HEAD hosted CI, Code Quality, Documentation CI, npm audit, Qodana,
  artifact, and review-thread evidence

### Incorrect

- No known remaining PR06 contract divergence has been accepted as correct.
  External review and the remaining executable Gates are pending, so this is
  not a final clean-review claim.

### Unverified

- Exact-final-HEAD backend/frontend reruns
- Dark/light, density, and reduced-motion behavior beyond current unit/static
  browser assertions
- Hosted real-backend two-user cookie/CSRF/revocation/reload/SignalR-degraded
  execution
- Hosted artifact integrity, secret-exposure scan, Qodana results, and
  unresolved review-thread count

### Out of scope

The kickoff out-of-scope list above remains unchanged. No PR07, PR08,
automatic scheduling, cascading movement, Critical Path, baseline, resource
leveling, cross-Project dependency, non-FS authoring, lag/lead, or Gantt-owned
persistence was added.

## Detailed requirement matrix

| Audit area | Initial classification | Current-main evidence | PR06 delta |
| --- | --- | --- | --- |
| Gantt snapshot | Partially complete | Existing authorized GET and compact DTO | Replace DTO/projection in place with bounded canonical contract |
| Project authorization | Partially complete | `CanViewProject` is invoked | Add typed permissions and command-side Gantt edit enforcement |
| Workspace membership | Unverified | Shared authorization foundation exists | Test active, revoked, and reauthorized actors |
| Project archive/read-only | Partially complete | Deleted rows are filtered | Define/test archive snapshot and mutation behavior |
| DTO versioning | Missing | Gantt DTO has no version fields | Project/workflow/calendar/row versions as supported |
| Workspace timezone | Partially complete | Workspace field and resolver exist | Use resolver and return explicit timezone |
| Working calendar | Unverified | No working-day/holiday service found | Return available summary only; do not fabricate |
| Task dates | Incorrect | Legacy start/due names in snapshot | Canonical `plannedStartDate`/`plannedEndDate` |
| Milestone dates | Incorrect | Nullable due date, no zero-duration marker | Required milestone date and zero duration |
| Parent derived dates | Partially complete | Shared calculator exists | Use it in snapshot; prohibit direct parent edit |
| Parent derived progress | Partially complete | Shared calculator exists | Project derived value and prohibit direct edit |
| Unscheduled Tasks | Missing | No separate list | Explicit deterministic unscheduled projection |
| FS dependencies | Partially complete | Persistence and core validation exist | Canonical version/error/Outbox/edit-result behavior |
| Legacy non-FS inventory | Missing | Returned without classification | Read-only plus structured warning |
| Structured warnings | Missing | No warning contract | Vendor-neutral warning collection and codes |
| Schedule permissions | Missing | No snapshot permission DTO | Project and per-item capabilities |
| Progress permissions | Missing | No Gantt permission DTO | Leaf/Milestone capabilities and backend enforcement |
| Optimistic concurrency | Partially complete | General Task command has version check | Focused command request/results and authoritative refetch |
| Audit | Partially complete | Shared Task/dependency audit foundations | Prove all PR06 mutations and rollback behavior |
| Outbox | Partially complete | Shared Task invalidation foundation exists | Prove Task/Project invalidations are transactional |
| HTTP error contract | Incorrect | Gantt/dependency paths collapse to 400 | Minimal PR06 typed safe envelope |
| Angular adapter | Partially complete | Vendor-neutral shell contract exists | Add canonical models/intents/results/state without vendor types |
| Accessible forms | Missing | Readable list only | Full keyboard/form parity with pointer actions |
| Mobile projection | Missing | No PR06 mobile workflow | Ordered lists and authorized actions at 320 px |
| Feature flag | Missing | Central flags exist; no Gantt flag | Add `tasks.ganttV1` as presentation rollout only |
| Realtime | Partially complete | PR05 patterns and infrastructure exist | Gantt invalidation/refetch/conflict/revocation handling |
| PostgreSQL query shape | Partially complete | Batched set queries, but unbounded | Bound graph; measure query count and capture SQL |
| Real Backend browser | Missing | No PR06 scenario found | Exact-final-HEAD real stack scenario without interception |

## DECISION REQUIRED

The canonical sources require the Gantt snapshot to be bounded and refer to a
canonical maximum, but the audited PR06 sources do not define:

1. the numeric maximum for WorkItems/milestones/dependencies, or
2. the required behavior when the maximum is exceeded (typed rejection,
   explicit truncation metadata, or pagination).

PR06 must not silently guess dates or silently truncate a graph. The owner must
select the numeric cap and overflow contract. This is the only independent
specification omission found in the initial audit; implementation of all other
confirmed requirements can continue.

Interim implementation:

- maximum 500 items counted as canonical Task-kind WorkItems plus canonical
  Milestones, consistently across snapshot, schedule, progress, and dependency
  paths;
- maximum 2,000 canonical dependencies;
- typed HTTP 400 rejection (`GANTT_ITEM_LIMIT_EXCEEDED` or
  `GANTT_DEPENDENCY_LIMIT_EXCEEDED`) when either limit is exceeded; and
- no truncation, inferred dates, or partial graph.

These are conservative implementation safeguards, not an owner-approved
canonical decision. Acceptance remains incomplete while the decision is open.

## Implemented contract ledger

This section records source-audited working-tree behavior. Executable evidence
and remaining qualifications are listed separately below.

### Snapshot

- Endpoint: `GET /api/projects/{projectId}/gantt`
- Item bound: provisional 500 canonical Task-kind WorkItems plus canonical
  Milestones, consistently applied across snapshot and all PR06 command paths;
  typed rejection and no truncation
- Dependency bound: provisional 2,000; typed rejection and no truncation
- Scheduled items: canonical Task items with at least one planned date
- Unscheduled items: canonical Task items with neither date and an `UNSCHEDULED`
  warning; no date inference
- Parent derived dates/progress: direct, non-deleted canonical Task-kind
  children only; `progressIsDerived=true`, `PARENT_DERIVED`, and direct edit
  denied
- Milestones: compatibility aggregate projected as canonical
  `kind=Milestone`, `milestoneDate`, 0/100 progress, zero-duration semantics,
  version, and missing-date warning
- Dependencies: same-Project canonical rows only; FS editable according to
  Project permission, legacy non-FS read-only; bounded reads require active
  canonical Task endpoints
- Calendar: actual resolved Workspace timezone; working days and holidays
  unavailable and explicitly limited; `calendarVersion=null`
- Warnings: `DEPENDENCY_VIOLATION`, `MISSING_ACTIVE_PLANNED_END`,
  `PARENT_DERIVED`, `LEGACY_DEPENDENCY_TYPE`,
  `MILESTONE_DATE_REQUIRED`, and `UNSCHEDULED`; every projected warning is
  non-blocking; dependency checks use derived dates for parent endpoints
- Permissions: top-level and per-item schedule/progress/dependency/clear/open
  capabilities derived server-side
- Versions: Project, Workflow, Task, Milestone, and successor/dependency command
  token; no independent working-calendar version exists

### Commands

- Schedule: `PATCH /api/tasks/{taskId}/schedule`; both
  `plannedStartDate`/`plannedEndDate` keys are required but nullable,
  `milestoneDate` is Milestone-only, and `expectedVersion` is required
- Progress: `PATCH /api/tasks/{taskId}/progress`; the progress member is
  required, integer 0-100, binary for a Milestone, with required
  `expectedVersion`; omission is rejected
- Dependency add: `POST /api/tasks/{successorTaskId}/dependencies`; request
  requires `predecessorTaskId`, canonical string
  `dependencyType="FinishToStart"`, and positive successor `expectedVersion`;
  unknown members, including lag/lead, are rejected
- Dependency remove:
  `DELETE /api/tasks/{successorTaskId}/dependencies/{dependencyId}?expectedVersion=...`
- Expected versions: positive and exact; stale versions map to HTTP 409 and the
  Angular flow performs authoritative refetch while preserving safe intent.
  Compatibility Milestone update also requires a positive version, enforces
  its date invariant, and maps stale revisions to 409
- Audit: metadata-safe schedule/progress/Milestone/dependency action records,
  plus reason-coded visible dependency rejections without hidden-neighbor
  metadata
- Outbox: canonical `Projects.TaskChanged.v1` and
  `Projects.ProjectChanged.v1` invalidations as applicable
- Atomic rollback: command state, audit, and Outbox use one EF save/transaction;
  failed-save tests verify no partial persistence

### Required no-cascade behavior

Dependency violations are warnings. Schedule/progress/dependency commands do
not move predecessor or successor dates automatically. The schedule command
updates only `PlannedStartDate`/`PlannedEndDate` and maintained compatibility
`StartDate`/`DueDate`; `DeadlineAt` is outside the command and PostgreSQL HTTP
tests verify that it remains unchanged.

### Parent and terminal invariants

- Only direct canonical Task-kind children participate in parent dates and
  progress; Milestones and non-Task rows are excluded.
- Done/Cancelled parents reject subtask creation until explicitly reopened.
- A terminal child cannot reopen to Backlog/Todo while its parent remains
  terminal.
- A parent can enter Done only when every direct canonical Task child is Done
  or Cancelled and the canonical derived progress is exactly 100.
- An all-cancelled child set stays derived with progress 0, so the parent Done
  transition is rejected.
- Review-override completion obeys the same parent guard. Restore and delete of
  a child beneath a terminal parent are rejected until the parent is reopened.

### Authorization and errors

- Viewer and Workspace ReadOnly actors receive read-only permissions and
  modifying commands are rejected server-side.
- Project Manager/Owner can edit Task/Milestone schedule and progress and
  manage FS dependencies. A contributor can edit only a Task they created or
  are primarily assigned to, subject to active Workspace membership.
- Archived/deleted Projects, deleted WorkItems, revoked membership, unknown
  neighbors, cross-Project IDs, and cross-Tenant IDs follow safe rejection and
  do not expose hidden titles or graph neighbors.
- PR06 endpoints use `401`, `403`, safe `404`, validation `400`, and
  concurrency `409`. The narrow safe JSON shape is:

```json
{
  "requestId": "trace-id",
  "error": {
    "code": "GANTT_STALE_VERSION",
    "message": "Work item has changed. Refetch and retry.",
    "target": null,
    "details": [],
    "redactionApplied": false
  }
}
```

This is a PR06-scoped alignment; it does not claim that the repository-wide
legacy error mismatch is resolved.

Request-aborted cancellation is rethrown so cancellation propagates rather
than becoming a false server error. An unexpected snapshot exception returns
HTTP 500 with `GANTT_REQUEST_FAILED`; unexpected Gantt/dependency command
exceptions use their safe command failure code.

### Date, timezone, and calendar

- Planning values are serialized as `DateOnly` `yyyy-MM-dd` values and remain
  day-precision in the Angular contract.
- The snapshot uses the canonical Workspace timezone resolver and returns the
  resolved IANA identifier. Browser-local `Date` parsing is not used for
  planning validation or display.
- The runtime has no canonical working-day/holiday service. It returns no
  fabricated working days or holidays and states both limitations.
- `DeadlineAt` remains a distinct UTC timestamp and is never inferred from or
  changed by a Gantt command.

## Verification evidence ledger

Entries explicitly labelled local working-tree evidence were executed during
implementation but precede the final code-bearing/documentation HEAD. They must
be rerun where the acceptance instructions require exact final-HEAD evidence.

### PostgreSQL

| Evidence | Status |
| --- | --- |
| PostgreSQL version | Local working-tree integration evidence: PostgreSQL 18.4 in an ephemeral `postgres:18-alpine` container |
| Latest migration | `20260730120626_AddCanonicalGanttVersions` |
| Empty apply | Passed in `GanttVersionMigrationAppliesToEmptyAndPr05UpgradeAndRollsBackAdditively` |
| Upgrade from PR05 | Passed from `20260729140506_AddProjectKanbanDefaultSwimlane`; existing Project/Milestone versions initialize to 1 |
| Additive down | Passed: down to PR05 removes only the two new version columns and preserves existing Project, Milestone, Task, and dependency rows. The migration performs no data normalization. |
| Pending migrations | Temporary migrated databases reported none; exact final environment check pending |
| Pending model changes | `dotnet ef migrations has-pending-model-changes`: none |
| Measured query count | Seven commands for the bounded repository projection: Project, Task count, Milestone count, Workflow version, Tasks/Stage/assignee, Milestones, and dependencies. The authorized real Kestrel/PostgreSQL snapshot is asserted at exactly 24 commands total, including tenant resolution, cookie/session authorization, membership, timezone resolution, and those seven projection commands. Overflow exits before loading rows/dependencies. |
| Generated SQL / EXPLAIN | Exact SQL is captured and emitted in xUnit evidence. Deterministic `ORDER BY`, bounded `LIMIT`, active dependency endpoints, the post-read combined-count recheck, the seven-command repository projection, the 24-command authorized HTTP total, cancellation, and absence of row-per-item N+1 are asserted. No `EXPLAIN` was required for the small synthetic fixture, and no speculative index was added. |
| Concurrency races | PostgreSQL regressions cover Project/Milestone tokens, a row inserted between the count gate and bounded reads, and shared Project-revision rejection of a dependency add racing a predecessor Task deletion; no stale edge persists. |

Migration note: the Up migration adds only Project and Milestone `VersionNo`
optimistic concurrency tokens. It does not update Task progress or any other
domain data. Down removes only those columns and preserves existing rows.

### Backend

| Check | Status |
| --- | --- |
| `dotnet restore AipPortal.slnx` | Succeeded; all projects were up to date |
| Release build | Passed at code-bearing HEAD `ab9a260dd4517d34a2500d5e76369ba241b504ee`, 0 warnings and 0 errors |
| `Scope=TaskV1PR06` | 45/45 passed, 0 failed, 0 skipped, with live PostgreSQL supplied |
| `Scope=TaskV1PR05` regression | 25/25 passed, 0 failed, 0 skipped |
| `Scope=TaskV1PR04` regression | 8/8 passed, 0 failed, 0 skipped |
| Full backend suite | 485/485 passed, 0 failed, 0 skipped at the code-bearing HEAD; hosted Gates on the final documentation HEAD remain pending |
| Unexpected skipped tests | 0 in every backend run above |

The focused PR06 evidence covers the canonical bounded/duplicate-free
snapshot, deterministic seven-command repository and 24-command authorized
HTTP query shapes, cancellation, migration paths, canonical Task-only parent
derivation and terminal parent/child transition/override/restore/delete
invariants, post-read bound checks,
Project/Milestone optimistic tokens, real Kestrel + Npgsql cookie/CSRF
commands, viewer/contributor/manager authorization, revoked/archived/deleted
and cross-scope rejection, schedule/progress/Milestone/dependency mutations,
stale versions, no-cascade/unchanged deadline, audit/Outbox, and failed-save
atomic rollback.

### Frontend

| Check | Status |
| --- | --- |
| `npm --prefix frontend ci` / audit | Succeeded; audit reported 18 known vulnerabilities: 3 low, 7 moderate, 8 high, 0 critical |
| Angular unit tests | Full suite 318/318 passed, 0 failed |
| Production build | Succeeded |
| Architecture checks | Application architecture check succeeded; Node architecture tests 4/4 passed |
| Syncfusion license check | Policy tests 4/4 passed; no license key was written to source or logs |
| Bundle analysis | Succeeded. Gantt remains a lazy production chunk (approximately 5.42 MB); initial bundle was 950.01 kB with a budget warning. |
| Storybook build | Exact default command exhausted the available 2 GB Node heap and is not a pass. The same source built successfully with `NODE_OPTIONS=--max-old-space-size=4096`; final/hosted evidence pending. |
| Mocked Playwright | 63 passed, 0 failed, 3 pre-existing explicitly expected skips. Focused PR06 Schedule desktop/mobile scenarios: 4/4 passed, 0 skipped. Browser response gate: 2/2 passed. |
| Real-backend Playwright | The no-interception PR06 scenario is implemented. Local execution cannot count because `SYNCFUSION_LICENSE` is unavailable; an exact-final-HEAD hosted run is required. |

Mocked Playwright proves Angular behavior only. It does not replace real
ASP.NET Core/PostgreSQL/cookie/CSRF evidence.

The hosted real-backend Gate must still prove, without API interception, two
real cookie-authenticated users, CSRF, canonical snapshot, schedule/progress/FS
dependency mutations, stale 409/refetch, revoked membership, reload
persistence, and SignalR-degraded HTTP fallback on the exact final PR HEAD. It
must report 0 failed, 0 skipped, a valid artifact, and no secret exposure.

### Realtime

| Behavior | Status |
| --- | --- |
| Stale-event rejection / duplicate coalescing | Implemented in the Schedule facade and covered by focused Angular tests; real transport pending |
| Active-edit conflict | Queues authoritative reconciliation, preserves safe intent, refetches authoritative HTTP state, then exposes explicit Retry-against-latest and Discard actions; focused Angular and real-browser source assertions are present |
| Reconnect reauthorization and refetch | Project subscription catch-up refetches the authoritative HTTP snapshot; hosted browser evidence pending |
| Authorization-revocation clear | A denied Project subscription synchronously clears protected Kanban and Gantt state and increments authorization/load/request generations before refetch, preventing stale response restoration; focused tests passed |
| SignalR-degraded HTTP/manual refresh | Degraded state retains HTTP edit and manual refresh behavior; focused/static browser tests passed |

### Hosted final-HEAD gates

| Gate | Status |
| --- | --- |
| Documentation CI | Pending |
| CI | Pending |
| `build-test` | Pending |
| `security-scan` | Pending |
| `frontend-test` | Pending |
| Code Quality | Pending |
| Qodana Community / .NET | Pending |
| Angular / TypeScript / JavaScript / HTML / SCSS / CSS | Pending |
| npm Security Audit | Pending |
| Real Backend Browser Smoke | Pending |
| Real Backend artifact validation | Pending |
| Secret exposure | Pending; must be 0 |
| Exact final-HEAD match | Pending |

The successful main kickoff runs above must not be substituted for these final
PR06 runs.

### Qodana and review

| Evidence | Status |
| --- | --- |
| Qodana Critical | Pending |
| Qodana Error | Pending |
| Reviewer residual material PR06 findings | 0 after reviewer reconciliation; Qodana and GitHub PR evidence remain Pending |
| Unresolved review threads | Pending |
| PR body synchronized | Pending |
| Verification synchronized | Working-tree implementation evidence synchronized; final SHA, hosted results, and review synchronization Pending |

## Protected and unrelated files

Initial worktree state before this audit file was added:

- `qodana.yaml`: pre-existing user-owned modification; not touched or staged
- `.aip-spec-source/`: pre-existing protected untracked directory; used only as
  a read-only specification reference and not staged
- `.tools/`: pre-existing protected untracked directory; not touched or staged
- `frontend/package.json`: the exact Syncfusion Angular Gantt dependency is an
  intended change for the vendor-isolated lazy adapter
- `frontend/package-lock.json`: currently changed, but npm 11.17 regeneration
  and focused diff review are pending; no final claim about lockfile scope is
  made yet

## Current blockers and verdict

Remaining blockers:

- DECISION REQUIRED: numeric snapshot cap and overflow behavior
- final documentation HEAD is not yet established; Draft PR #259 is open at
  code-bearing HEAD `ab9a260dd4517d34a2500d5e76369ba241b504ee`
- exact-final-HEAD backend/frontend and hosted suites are pending
- the exact default Storybook command has not passed in the local 2 GB Node
  heap
- licensed hosted real-backend browser evidence is pending
- final-HEAD Documentation CI, CI, Code Quality, npm Security Audit, Qodana,
  artifact, and review-thread evidence is pending

Current Gate:

- TASK-V1-PR05: Complete
- TASK-V1-PR06 acceptance: Incomplete
- PR06 Merge: No-Go
- Merge performed: No
- TASK-V1-PR07: No-Go pending PR06 merge and post-merge audit
- PR08: No-Go

This verdict must be replaced only by a final evidence-backed Go/No-Go report
from the exact final PR06 HEAD. Even if every PR06 Gate later passes, this task
must not merge the pull request.
