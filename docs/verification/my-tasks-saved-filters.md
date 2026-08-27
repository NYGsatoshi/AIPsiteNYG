# My Tasks saved filters verification

Status: Issue #346 implementation candidate with local storage, facade,
component, production-build, architecture, and representative mocked-browser
verification complete. Exact-head CI and the existing real-backend gate remain
required before merge.

## Change identity

- Branch: `feat/346-my-tasks-saved-filters`.
- Starting `main` baseline: `dea7f12be12085f22536456c6fcfeb027ee04555`.
- The exact PR head and hosted check results belong in the PR because this file
  cannot name the commit that first contains itself.

## Persistence and identity boundary

Custom filters are browser presentation preferences stored under a versioned
key partitioned by authenticated `{tenantId, userId, screenId}`. The payload
contains only a user-supplied name and the My Tasks relationship, Project ID,
Stage, Priority, Blocked, urgency, and search inputs. It never stores rows,
counts, Task or Project titles, Workspace labels, permissions, credentials, or
authorization results.

Parsing is fail-closed. Unknown versions, extra fields, invalid enums, invalid
Project identities, duplicate IDs, and case-insensitive duplicate names discard
the whole namespace. Missing identity returns no filters without reading
storage. Browser storage read/write/remove failures remain non-blocking and are
announced; a failed write retains the last successfully loaded descriptors.
Logout and authenticated identity changes clear active filter execution before
loading only the new identity namespace.

## Query and authorization boundary

The built-in presets are exact relationship/Stage pairs:

- Running: `assigned` and `inProgress`;
- Needs review: `reviews` and `review`;
- Completed: `completed` and `done`.

Presets retain the other optional filters. Applying a custom filter or clearing
all filters cancels a pending debounced search, moves to page 1, and emits one
list/count request pair from the single resulting snapshot. Clear all returns
the relationship to Assigned and removes optional filters while retaining the
explicit current-Workspace or all-Workspaces scope.

Local preferences never authorize data. Every apply calls the existing
server-authorized `GET /api/me/tasks` and `GET /api/me/tasks/counts` endpoints.
A saved Project ID is submitted to those endpoints but is masked from the
input and summarized only as `Project filter active`; no locally cached label
is resolved. Denied, not-found, or authorized-empty results cannot restore a
Task row, count, title, snippet, or Workspace label.

## Accessibility and narrow-width behavior

The canonical `/tasks` List provides native-button frequent presets, a native
save form, Apply/Delete controls, visible applied-condition chips, Clear all,
and a polite atomic live region. Storage-unavailable state truthfully disables
custom persistence while keeping current filters and built-in presets usable.
Keyboard submission and focus return are covered. The representative built-app
smoke runs the complete save/apply/clear interaction at 320 pixels, checks for
horizontal overflow, runs axe, and confirms the opaque Project ID is absent
from rendered text.

## Issue #346 acceptance mapping

| Acceptance criterion | Candidate evidence |
| --- | --- |
| Running, Needs review, and Completed presets | Exact relationship/Stage query pairs with other optional filters retained |
| Save, apply, and delete custom filters | Strict versioned local preference service plus accessible browser controls |
| Show applied conditions and clear them | Relationship and optional-filter summaries, polite announcements, and scope-preserving Clear all |
| Keep preferences Tenant/user scoped | Authenticated Tenant/user/screen key, unresolved-identity empty state, logout/user-change regression |
| Preserve server authorization | Existing `/api/me/tasks` list/count pair remains authoritative; saved Project values never grant or resolve access |
| Responsive and keyboard accessible | Native controls, focus regression, axe, and desktop/mobile 320-pixel built-app smoke |

## Local verification

Completed on this candidate:

- focused Angular saved-preference/facade/UI tests: 3 files / 63 tests passed;
- exact isolated reproduction of the unrelated full-suite timeout: 1 file / 5
  tests passed;
- Angular production build: passed, with only pre-existing initial-bundle and
  unrelated component-style budget warnings;
- frontend architecture source check and four architecture regression tests:
  passed;
- representative built-app Playwright smoke: 2 projects passed
  (`chromium-desktop` and `chromium-mobile`) at 320 pixels; and
- `git diff --check`: no whitespace errors (Windows line-ending notices only).

The local full Angular run built successfully and completed 877 of 878 tests.
One untouched Task table rendering test exceeded its five-second timeout under
the full runner's high worker load (6.15 seconds). The exact file then passed
all 5 tests in isolation with 2.17 seconds of test execution. This is recorded
as local resource-contention/flaky evidence, not hidden or counted as a full
suite pass. Exact-head Linux CI is the required full-suite merge gate.

The mocked browser run does not prove backend authorization or transport
compatibility. The repository's existing real-backend gate and exact-head CI
remain required before merge.

## Scope confirmation

- No backend preference entity, API, schema, migration, or public contract is
  added.
- No authorization policy, Tenant/Workspace boundary, or frozen U-22 release
  metadata is changed.
- Saved filters apply only to canonical `/tasks` My Tasks; Project Kanban and
  other screens are unchanged.
- Browser labels, task data, counts, and authorization decisions are never
  persisted.
