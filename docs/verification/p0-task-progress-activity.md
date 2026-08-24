# P0 Task progress and Activity verification

Status: Issue #369 implementation candidate, rebased onto current `main` at
`55a3f084341266de7175bf66e5c7ed881613d6fd` (#420, announcement editor
accessibility).
Current focused rebase verification is recorded below. Historical
initial-baseline evidence is retained separately and must not be treated as
evidence for this rebased candidate. PostgreSQL, complete regression,
hosted-CI, review, and merge evidence remain qualified below.

## Change identity

- Branch: `fix/369-progress-activity`.
- Initial implementation baseline (historical): `03850d5`.
- Current rebased candidate base: `55a3f084341266de7175bf66e5c7ed881613d6fd`
  (#420, announcement editor accessibility).
- No schema migration, Activity write command, or generated hosted artifact is
  part of this change.

## Source-authority decision

The existing configured `TaskWorkflowStage` is sufficient authority for the
current Task phase. Its fixed category vocabulary is exactly Backlog, Todo,
InProgress, Review, Done, and Cancelled. Blocked remains independent. There is
no canonical Task Failed category.

The existing `ActivityLog` supplies authorized secondary detail when a
Task-linked record already exists: it has Tenant, Project, optional Task, type,
body, occurrence time, and author fields. Current production source has no
Task Activity writer, and Issue #369 adds no writer or claim that Task commands
produce execution history. It also does not add a schema, runtime service,
completion percentage, target Stage, or inferred transition. Current source
contains no authoritative historical Stage-transition sequence, so the UI
explicitly does not synthesize one.

## Read and authorization contract

`GET /api/tasks/{taskItemId}/activity?page=1&pageSize=20` first resolves a
current non-deleted Task through the existing Project read authorization. A
denied or missing Task returns the safe Task-not-found result before any
Activity query. The subsequent read is Tenant-filtered and requires both the
authorized Task's `ProjectId` and `TaskItemId`; a mismatched pair returns no
rows.

Paging is bounded to 1 through 50 items, ordered by `OccurredAt DESC` and then
`Id DESC`, and returns `items`, `page`, `pageSize`, `totalCount`, and `hasMore`.
The projection contains only Activity ID/type/body/time and author ID/display
name. It does not expose AuditLog, infer privileged audit history, or broaden
the current Project boundary.

Canonical Task detail does not depend on the Activity query and does not embed
an Activity page. This is intentional: a transient Activity repository or HTTP
failure cannot erase the authorized current Workflow Stage.

## Browser presentation and freshness

Task detail presents a primary `Progress` surface with configured Stage name
as `Current phase` and a text state label derived from the fixed category.
It does not display the legacy numeric progress field as the phase and does not
derive a new percentage from Activity volume.

Activity is a collapsed secondary disclosure. Opening it performs the first
authorized Activity GET. StatusUpdate entries are visually emphasized; Note,
Decision, and Issue remain detail events, with Issue labelled `Needs attention`.
No entry or request failure is shown as Task `Failed`.

Activity has independent idle/loading/empty/error/retry/load-more state. A
transient initial failure leaves the phase visible. A later-page or realtime
refresh failure retains the loaded page. Retrying page one replaces it from
HTTP; retrying a later page appends de-duplicated IDs. Task realtime events are
invalidation hints only: canonical detail is refetched, and Activity page one
is refetched only after that disclosure has been requested. Route, Workspace,
authorization, and Task generations discard stale responses. Activity 401/403
reauthorizes after clearing protected data, and safe 404 clears it without a
sibling-resource probe.

At 320 pixels the phase cards and Activity metadata stack, Activity bodies wrap,
the native disclosure remains keyboard operable, focus is visible, and no
horizontal scrolling is required. The Activity list is semantic and occurrence
times retain their raw ISO value in `datetime`.

## Verification inventory and remaining gates

### Current rebased candidate verification

Completed after rebasing onto
`55a3f084341266de7175bf66e5c7ed881613d6fd`:

- focused backend `Scope=Issue369` ran 7 tests: 6 passed and 1 conditional
  PostgreSQL translation/order test skipped because
  `POSTGRES_TEST_CONNECTION_STRING` is unset. The passing scope covers the
  Application authorization/paging boundary, repository filtering/order, and
  Kestrel/EF Core InMemory HTTP route and cross-Tenant safe-404 behavior;
- focused Angular tests passed 56/56 across the Projects facade and Task-detail
  component specs, including standalone Activity mapping, paging, retry/error
  isolation, phase vocabulary, and safe authorization clearing;
- the production Angular build passed. It retained budget warnings, including
  Task-detail CSS at 7.78 kB, below its configured 8 kB error threshold; and
- six targeted static Chromium browser tests passed across desktop and mobile:
  direct-route phase/Activity disclosure, Task Brief edit/review, and initial/
  later Activity failure with retained rows and retry behavior.

### Historical initial-baseline evidence

The following results were recorded before the rebase, against the initial
`03850d5` baseline. They are historical context only and do not establish the
current rebased candidate:

- the .NET solution build succeeded with zero errors and six pre-existing
  warnings, and the full .NET run reported 894 passed with 241
  environment-gated skips;
- focused Application/repository and Kestrel/EF Core InMemory HTTP coverage
  passed for authorization-before-query, deleted-Task denial, clamp behavior,
  Project/Task filtering, author projection, stable paging, route discovery,
  canonical-detail independence, JSON shape, unauthenticated 401, and
  cross-Tenant safe 404;
- focused Angular coverage reported 55 passing tests across the facade and
  Task-detail component, and the production build plus frontend architecture
  check passed; and
- the historical full Angular run reported 736 of 737 passing tests. Its one
  unrelated Files-page timeout was followed by 6/6 isolated passes, so it was
  always qualified rather than a clean full-regression result. Historical
  focused Chromium coverage reported four desktop/mobile tests passing.

The conditional real-PostgreSQL translation/order test is present but was the
one skipped test in the current focused rebase run because
`POSTGRES_TEST_CONNECTION_STRING` is unset. EF Core InMemory and mocked static
browser results are not PostgreSQL or frontend/backend integration evidence.
Pinned-Linux screenshot parity, full Playwright regression, exact-head hosted
CI, review-thread closure, and merge gates remain for final review unless
recorded later in this file or the PR.

## Explicit non-goals

- no Activity creation/update/delete command;
- no AuditLog exposure or audit-to-Activity conversion;
- no historical Stage transition synthesis;
- no schema migration or new percentage field;
- no Task Failed category; and
- no claim that a mocked browser proves backend compatibility.
