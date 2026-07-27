# TASK-V1-PR03C final acceptance verification

Verification worktree: `task/v1-pr03c-task-detail-ui` based on
`66f8723e0a61fdcfdaa0ac8496269a81fc9f7ee1`.

Base: `dc91f3064549fc70a625c2b5b00c51731a022d65`.

This document records the closure investigation truthfully.  It is not a PR03C
completion claim: the mandatory real-backend browser gate could not be run in
this environment, so no new final-acceptance commit, PR-body completion update,
or merge recommendation has been made.

## Historical state

The prior verification document was written on 2026-07-23.  It recorded that
the branch implementation existed, while PostgreSQL execution, migration-chain
validation, HTTP/OpenAPI contract evidence, real-backend Playwright, CI/Code
Quality, and a non-Draft PR state had not yet been evidenced.  At that time the
local .NET runner was blocked by Windows application-control policy; it was not
represented as an executed backend test.

The current PR is non-Draft and open, with 51 commits and 84 changed files.
Its current baseline CI (`30267407949`) and Code Quality (`30267408182`) were
successful for `66f8723…`; those runs are historical baseline evidence, not
evidence for uncommitted closure changes.

## Final scope

Authoritative sources reread for this investigation were the Task V1 PR02
command boundary, the PR03C detail-contract/acceptance sources, File download
grant and permission/error mapping sources, PR #229 foundation scope, PR #249
detail-contract scope, and the current PR #250 body.

The canonical Angular route is `/projects/:projectId/tasks/:taskId` (hosted
under `/app`).  The canonical aggregate endpoint is
`GET /api/tasks/{taskId}`; there is no separate `/detail` route.  PR03C covers
the bounded Task aggregate, relationships, permissions, Subtasks, Checklist,
Comments/Mentions, Labels, current-user Watch state, Files, and current
authorization for Attachment open/download grants.  It excludes PR04 My Tasks
projection and Prompt 3 work.

## Implemented contract

`ProjectsController` is the route authority.  The HTTP contract test fixes the
following current routes rather than creating speculative aliases:

| Area | Current routes |
| --- | --- |
| Task | `GET`/`PATCH /api/tasks/{taskId}`, `GET /api/tasks/{taskId}/subtasks`, `POST /api/tasks/{taskId}/subtasks` |
| Checklist | `GET`/`POST /api/tasks/{taskId}/checklist`, `PATCH`/`DELETE /api/tasks/{taskId}/checklist/{itemId}`, `PUT /api/tasks/{taskId}/checklist/order` |
| Comments and mentions | `GET`/`POST /api/tasks/{taskId}/comments`, `PATCH`/`DELETE /api/task-comments/{commentId}`, `GET /api/tasks/{taskId}/mention-candidates` |
| Labels | `GET`/`POST`/`PATCH /api/projects/{projectId}/task-labels`, `PUT`/`DELETE /api/tasks/{taskId}/labels/{labelId}` |
| Watch | `GET`/`PUT`/`DELETE /api/tasks/{taskId}/watch-state` / `/watch` (the state route is GET; the latter two are mutations) |
| Files | `GET`/`POST /api/tasks/{taskId}/files`, `DELETE /api/tasks/{taskId}/files/{associationId}` |
| File grant | `POST /api/attachments/{attachmentId}/download-grants`, followed by `POST /api/attachment-download-grants/{grantId}/download` |

There is no OpenAPI/Swagger generator or committed snapshot in the current
tree.  The formal local mechanism is therefore the new Kestrel controller HTTP
contract test, `TaskDetailHttpContractUsesCanonicalRoutesSafeErrorsAndBoundedAggregate`.
It fixes route presence, request validation, aggregate/page shape, safe field
exclusion, `401`/`403`/safe `404`/`409`, and `429` Problem Details plus a
positive `Retry-After` header.

All versioned PR03C mutations now reject missing, zero, or negative
`expectedVersion` with `TASK_INVALID_EXPECTED_VERSION`, including Checklist,
Comments, label association/archive, and Task/File association commands.
`Watch` deliberately accepts the documented zero sentinel only while no
current-user Watch row exists; subsequent Watch mutations use the returned
Watch version.  Task/File archive state is represented as safe `Missing`, not
an undocumented `Archived` access state.

Observed JSON serialization through the HTTP contract is: Task `priority` is a
string; Task `stageCategory` and `reviewStatus` are numeric; Task file
`scanStatus` and access capability flags are string/boolean; page fields are
numeric/boolean.  The contract test also asserts that aggregate File responses
do not contain `storageKey`, `filePath`, token/hash, signed URL, or internal
path.  The grant response is deliberately outside that aggregate and is never
stored in Angular signal state or verification evidence.

### Angular mapping correspondence

| Backend aggregate | Angular transport/view-model handling |
| --- | --- |
| Canonical Task identity, tenant/workspace/project, kind, parent, workflow, planned dates, progress, review, version, subresource counts | `projects.api.ts` `TaskDto` and `canonicalTask` in `TaskDetailAggregateViewModel` |
| Relationships | `TaskRelationshipsDto` and `relationships` view model; primary assignee is displayed rather than replaced by a placeholder |
| Detail permissions | `TaskDetailPermissionsDto` and all twelve booleans in the view model |
| Checklist, Comments, Subtasks, Files | typed DTOs retain item fields and `page`, `pageSize`, `totalCount`, `hasMore` |
| Labels and current-user Watch | typed label/watch DTOs; no other actor's Watch intent is mapped |
| File capabilities | safe association ID plus `canOpen` and `canRequestDownloadGrant`; token/storage fields are not DTO members |
| Errors | `normalizeApiError` preserves safe message, HTTP status, and request ID; conflict and authorization paths clear protected Task state before reload |

## Final evidence

The following commands were run against the current closure worktree.  The
dedicated PostgreSQL 18 container used port 5440 and a new
`aipsite_pr03c_acceptance_pgdata` volume; no existing local PostgreSQL
container or volume was modified or removed.

| Check | Result |
| --- | --- |
| Release backend build | Passed, 0 warnings / 0 errors |
| Clean PostgreSQL migration | `dotnet ef database update` passed from an empty dedicated database through `20260726150000_EnforceManualWatchOptOutExclusivity` |
| Pending model changes | `dotnet ef migrations has-pending-model-changes` reported no changes |
| Clean/upgrade migration contracts | `Category=PostgreSQLIntegration`: 60 passed / 0 failed / 0 skipped; includes clean, legacy comment, Task/File, label, and Watch migration scenarios |
| PR03C HTTP contract | 1 passed / 0 failed / 0 skipped (Kestrel controller contract) |
| `Scope=TaskV1PR03C` run 1 | 25 passed / 0 failed / 0 skipped after the required clean migration |
| Prompt 2-C regression | 32 passed / 0 failed / 0 skipped |
| Prompt 2-D regression | 19 passed / 0 failed / 0 skipped |
| Full backend | 399 passed / 0 failed / 0 skipped, with PostgreSQL configured |
| Angular unit | 37 files, 236 passed / 0 failed |
| Angular production build | Passed; pre-existing budget warnings remain |
| Angular architecture | Passed |
| Storybook build | Passed; existing no-MDX and size warnings remain |
| Mock Angular Playwright | 52 passed / 0 failed; 2 explicitly obsolete legacy-static tests skipped and excluded from PR03C acceptance counts |

The first focused PostgreSQL invocation was made before applying migrations to
the otherwise empty dedicated database and failed with missing relation
`tenants` (15 failed / 10 passed).  It is retained here as execution history,
not used as passing evidence.  After `dotnet ef database update`, the focused
run above passed with no skips.

### Real-backend browser evidence

`npm.cmd run test:ui:real-backend` was invoked using the repository's isolated
Compose runner.  It did **not** reach migrations, the ASP.NET Core host, or
Playwright because the production-image Docker build requires the
`syncfusion_license` secret and `SYNCFUSION_LICENSE` was not configured.  The
runner stopped at `npm run build:licensed`; no mock substitution, no secret
fabrication, and no production data were used.

The added test is intentionally real-backend-only and contains no Task API
route interception.  It is prepared to verify synthetic login/cookie/CSRF,
aggregate rendering, safe route-project mismatch, Checklist and Comment/Mention
mutations with refetch, Label/Watch read, safe File metadata, a current grant,
real workspace-membership revocation, denied re-grant, and cleared protected UI
state.  It remains **unexecuted** until the required CI/test-only license secret
is supplied.

## Full PR independent audit

All 84 files from `dc91f306…` to `66f8723…` were reviewed in grouped form,
with `git diff --check` clean.  The Task/Application/Infrastructure/frontend
and test changes implement the PR03C aggregate, concurrency, audit/outbox,
tenant/workspace/project authorization, File reauthorization, and migration
contracts.  PostgreSQL tests verify loser-side atomicity (no mutation/audit/
outbox and cleared change tracker) and event version alignment for
`Projects.TaskChanged.v1` with `requiresRefetch: true`.

Migration IDs are chronological; the clean migration and upgrade scenarios
passed, model snapshot agrees with the model, and no pending migration/model
change was reported.  `ProjectAuthorizationService` now requires active
Workspace access before Project membership/visibility.  Its callers in Project,
Task, File, Messaging, Artifacts, My Tasks, Notifications, and Admin/Audit
paths were searched; the current PostgreSQL and backend suites found no
regression.  This is not a substitute for the blocked real-browser revocation
scenario.

The Qodana workflow diff isolates result directories per run and disables stale
caches, so it is CI reliability work adjacent to the prior verification issue.
The PR also contains two unrelated/non-essential deltas: Angular CLI analytics
in `frontend/angular.json` and one `peer` metadata line in `package-lock.json`.
They were not removed during this incomplete closure because the branch is
already at the supplied actual HEAD and no destructive history/working-tree
operation is permitted.  They remain a merge-readiness audit finding.

`qodana.yaml`, `.aip-spec-source/`, and `.tools/` were protected local user
changes throughout this work and were neither modified, staged, restored, nor
committed.

## Remaining blockers

1. The mandatory real ASP.NET Core + PostgreSQL + built Angular + cookie/CSRF
   PR03C Playwright run is unexecuted because `SYNCFUSION_LICENSE` is absent.
2. Therefore no final-head CI/Code Quality rerun, PR-body synchronization, or
   final acceptance commit can be treated as PR03C evidence.
3. The two unrelated PR diffs above require an explicit merge-readiness decision
   or cleanup before a Merge-Go claim.

## Final verdict

**Incomplete.**  `PR03C acceptance: Incomplete`; `Prompt 2 overall:
Incomplete`; `PR #250 Merge: No-Go`; `PR04 migration: No-Go`; `Prompt 3:
No-Go`.  No merge, auto-merge, PR04, Prompt 3, or subsequent migration work
was started.
