# P0 Task state-list verification

Status: Issue #342 implementation candidate. Local backend, Angular, build,
Storybook, architecture, and focused browser gates are complete. Real-backend,
provider-backed, hosted, review, and merge evidence remains pending unless the
final PR records it.

## Change identity

- Branch: `fix/342-task-state-list`.
- Starting `main` baseline: `7b5e7d4ca8621633a965252a905c141da52b383f`.
- The final PR head and exact hosted results must be recorded in the PR because
  this file cannot name the commit that first contains itself.

## Canonical Task state contract

The Project Task-list response retains the legacy `status`, timestamps, and
existing compatibility fields. It adds the current Workflow Stage ID and
display name, the fixed Stage category as a JSON string, independent Blocked
state, and one Artifact-availability boolean.

The fixed Task categories are exactly:

- `Backlog`;
- `Todo`;
- `InProgress`;
- `Review`;
- `Done`; and
- `Cancelled`.

There is no canonical Task `Failed` category. `Failed` in the current product
contracts is a terminal state of the deadline-digest delivery ledger, not a
Task state. The candidate therefore does not invent a seventh category or
map Blocked/Cancelled to Failed. Blocked remains an independent flag that can
be displayed alongside any Stage.

The API serializes the new Stage category as a string. The Angular adapter
parses canonical Stage categories separately from the numeric legacy
`TaskItemStatus`; their numeric ordinals are not interchangeable. The list
shows the configured Workflow Stage display name and presents the fixed
category through the shared icon-and-text status badge.

## Artifact privacy boundary

The server checks the current actor's canonical Project-read authorization
before querying Task-linked Artifacts. After authorization, one bounded,
read-only Project-scoped projection returns distinct Task IDs that have at
least one non-deleted linked Artifact. The Task response exposes only
`hasArtifact`; it does not expose an Artifact ID, name, count, type, status,
version, file, or storage field.

Deleted, unlinked, and other-Project Artifacts do not set the signal. The query
uses the existing Tenant filter and the same Project boundary that authorizes
the Task list. It is performed once for a Project list rather than once per
Task. Hiding the browser indicator is not authorization; the server projection
is the only source of the boolean.

The current Artifact create routes do not expose a new Task-association
mutation for this issue. Adding or changing that mutation is an explicit
non-goal.

## List presentation and freshness

Desktop retains the maintained sortable grid. The state-focused columns put
the Task title, configured Stage, fixed category, independent Blocked state,
last update, Artifact availability, and Open action together. `UpdatedAt` is
used when present and `CreatedAt` is the explicit fallback; the rendered value
uses a semantic `time` element with the raw ISO value in `datetime`.

At 40 rem and below, the wide grid is replaced by a semantic list of Task
cards. Each card retains the same state fields and actions in the viewport.
The representation uses text and icons rather than color alone, keeps a
44-pixel action target and visible focus, and does not require horizontal
scrolling at 320 pixels.

Project Task and Workflow realtime events remain invalidation hints. Relevant
events and successful Stage/schedule/progress mutations trigger a coalesced,
generation-guarded authoritative Task-list GET. Stale responses cannot
repopulate a released or reauthorized Project scope. SignalR payloads are not
used as Task-list content.

Server-side pagination expansion and virtualized large-Project delivery are
outside Issue #342. The existing bounded Project list contract remains in
force.

## Acceptance mapping

| Issue #342 criterion | Candidate evidence |
| --- | --- |
| Identify the main state without opening a Task | Configured Stage name plus shared icon-and-text category badge in every row/card |
| Compare last update time | Semantic `time` using `UpdatedAt`, with `CreatedAt` fallback |
| Identify output availability | Backend-owned boolean rendered as `Artifact available` or `No artifact` |
| Scan Running / Needs review without color-only meaning | `InProgress` maps to shared Running and `Review` to Needs review; both include icon and text. No non-canonical Task Failed state is fabricated |
| List remains consistent after state change | Successful commands and realtime invalidations coalesce into an authoritative HTTP list refresh with generation guards |
| Do not expose unauthorized Artifact information | Project authorization precedes one Task-ID existence projection; only a boolean is returned and denied Project reads do not query Artifact state |

## Verification inventory and remaining gates

Completed locally on this candidate so far:

- focused Project service/repository/HTTP contract tests, including all six
  canonical categories, independent Blocked state, string serialization,
  timestamp retention, one-query list behavior, pre-authorization denial, and
  deleted/unlinked/other-Project Artifact negatives;
- full backend regression: 884 passed, 0 failed, and 238 provider-dependent
  skips because `POSTGRES_TEST_CONNECTION_STRING` is unavailable locally;
- full Angular regression: 67 files / 634 tests passed after the unrelated
  Files #337 timing-sensitive case was proved 6/6 in isolation and the
  non-competing full rerun passed;
- production Angular build, architecture check, and Storybook build (the
  Windows Storybook process required a 4 GB Node heap);
- focused desktop/mobile Playwright: 4/4 passed for state scanning, 320-pixel
  layout, keyboard/focus, axe, and authoritative post-command refresh;
- pinned-Linux Playwright parity: 94 passed and 6 intentionally skipped after
  running the CI helper from an LF-normalized temporary container directory;
  screenshots, responsive renderers, and axe checks passed; and
- five browser-smoke seed tests, including idempotent creation of one
  Task-linked synthetic Artifact while the actor remains an ordinary Tenant
  Member.

Still required before merge:

- real-backend browser verification of the JSON string category, timestamps,
  boolean-only Artifact signal, and rendered list;
- PostgreSQL execution of the Task/Artifact projection test (the local
  `POSTGRES_TEST_CONNECTION_STRING` is unavailable); and
- exact-head hosted CI, conflict, review-thread, and merge-gate verification.

Mocked browser evidence cannot prove backend compatibility or authorization.
EF Core InMemory evidence cannot prove PostgreSQL translation. A skipped
provider test is not reported as provider-backed evidence.

## Scope confirmation

- No schema migration, destructive data change, authorization weakening, or
  public breaking contract is introduced.
- Artifact details, counts, versions, and association commands remain outside
  the Task list.
- The Task-list endpoint's existing page-size contract is unchanged.
- Task execution/result persistence, Task Brief, source scope, and quality
  checklist remain owned by their separate U-22 dependency issues.
