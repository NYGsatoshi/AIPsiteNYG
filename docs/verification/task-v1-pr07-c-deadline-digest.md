# TASK-V1-PR07-C Workspace deadline digest verification

## Status

The PR07-C implementation candidate is present on
`task/v1-pr07-c-deadline-digest`. This record describes the current worktree;
it is not merge authorization and does not relabel PR07-C as complete. The
branch must remain a non-merged Draft until its exact final HEAD and hosted
checks are recorded outside any self-referential source commit.

PR07-C covers generation only. Current-authorized delayed dispatch/replay,
notification opening, SignalR route changes, Angular reconciliation, and final
PR07 operations/acceptance remain PR07-D/E. No evidence below proves those
later phases.

## Authority and identity

| Field | Value |
| --- | --- |
| Implementation repository | `NYGsatoshi/AIPsiteNYG` |
| Task | `TASK-V1-PR07-C` |
| Branch | `task/v1-pr07-c-deadline-digest` |
| Accepted branch base | `93b1c5e260e04c243ff84f7370aca4d869484087` |
| PR07-B pull request | `#275`, merged |
| PR07-B post-merge entry gate | Recorded green for same-SHA main CI, Code Quality, Documentation CI, and npm Security Audit in `docs/TASK_V1_PR07_PLAN.md` |
| Canonical specification commit | `8b90c8897367606473515d17d3696e458b2ee7b5` |
| Focused owner decision | `docs/decisions/task-v1-pr07-c-deadline-digest-decisions.md` (`Resolved`, 2026-08-03) |
| Migration | `20260803041347_AddTaskDeadlineDigestLedger` |
| Policy version | `1` |
| Code-bearing HEAD | Not yet immutable; exact SHA belongs in the Draft PR body after the final documentation commit |
| Pull request | Not created by this verification record; required title is `TASK-V1-PR07-C: implement Workspace deadline digest` |
| Merge performed | No |

Current source, tests, root deployment configuration, and active documentation
remain implementation authority. The owner decision narrows current digest
relevance without changing PR07-B's immediate-recipient matrix.

## Separated state machines

The Transactional Outbox is not the digest scheduler.

| Concern | Durable authority | Terminal generation/delivery state |
| --- | --- | --- |
| Daily identity, due time, claim, retry, generation outcome | `task_deadline_digest_jobs` plus append-preserved `task_deadline_digest_attempts` | Digest `Succeeded` or `Failed` |
| Notification signal delivery/retry/dead-letter | Existing transactional Outbox | Existing Outbox delivery/dead-letter contract |

One job is unique by exactly:

```text
TenantId
WorkspaceId
UserId
LocalDate
PolicyVersion
```

The job stores current state, counts, scheduling/claim timestamps, bounded error
code, completion time, and optional Notification reference. The attempt table
preserves every automatic or operator claim. Claim owner, expiry, and random
token fence concurrent or expired workers; PostgreSQL due and expiry selection
uses deterministic order and `FOR UPDATE SKIP LOCKED`.

The automatic budget is exactly three. The third automatic failure or expiry
is terminal. An approved operator restart requires a terminal job, appends one
linked `OperatorRestart` attempt with `RequestedByUserId`, and writes the
generic `TaskDeadlineDigestRestarted` AuditLog record in the same transaction.
It permits one attempt and never resets `AutomaticAttemptCount` or rewrites the
earlier attempts as a new automatic series. There is no digest dead-letter
table.

## Workspace-local schedule and DST

The effective local time is the member's nullable override or the Workspace
default. Only exact 15-minute wall times from `00:00` through `23:45` are
valid. The Workspace timezone is primary, then the Tenant timezone, then UTC;
invalid identities increment aggregate diagnostics.

The ledger date is the current Workspace-local date. A nonexistent wall time
advances to the first valid instant after the DST gap. An ambiguous wall time
uses its first chronological UTC occurrence; the five-field unique identity
prevents a second row or claim during the fold. Generation re-resolves current
timezone and preference: a stale local-date identity succeeds with no visible
digest, while a current identity whose new due instant is still future is
deferred.

Pure policy tests exercise both gap and fold. The real PostgreSQL suite also
contains integrated scheduler/upsert/claim cases for both directions:
`America/New_York` `2026-03-08 02:30` advances to the first valid `07:00Z`
instant and creates one identity, while both UTC occurrences of the
`2026-11-01 01:30` fold observe one ledger row/claim. Both integrated cases
executed in the current 72-case PostgreSQL-backed scope run recorded below.

## Candidate and commit authorization

The four output categories are deadline in three Workspace-local days,
deadline in one local day, due today, and overdue. `Overdue` is strictly before
the captured current instant; an equal instant is due today.

Visibility is necessary but not sufficient. The approved relevance predicate
requires current effective Watch from a current manual Watch or current
Creator/Primary-Assignee/Collaborator/Reviewer source. Explicit opt-out
suppresses digest relevance. Visibility alone and Team Queue eligibility do
not qualify. Watch does not grant authorization.

Current Tenant/user, TenantUser, active Workspace membership, Workspace,
Project authorization and lifecycle, Task deletion/completion/cancellation,
Workflow terminal stage, and relationship source are all checked. The
generator evaluates candidates before its transaction, then locks the claimed
job and recipient User before repeating that evaluation immediately before
commit. A membership or lifecycle change that commits while the recipient lock
is waiting is therefore visible to the final authorization check. Revoked,
archived, deleted, completed, cancelled, opted-out, or relationship-lost
candidates cannot survive from the first build into the visible result.

The PostgreSQL candidate suite distinguishes all accepted Watch sources from
opt-out, visibility-only, Team Queue-only, and restricted-group unauthorized
rows. It covers current authorized system/Workspace roles and allowed
non-archived Project states, then mutates membership, Workspace, Project, Task
lifecycle, and relationships and verifies the current query drops stale
candidates.

## Result, atomicity, and privacy

A non-empty final evaluation stages exactly one generic recipient Notification:

- numeric type `TaskDueSoon`;
- title `Task deadline digest`;
- null body;
- `TaskDeadlineDigest` job reference;
- stable logical key derived from Workspace, local date, and policy version.

The existing Notification unique identity adds Tenant and recipient. Its
recipient-only `Notifications.NotificationCreated.v1` signal contains only
`notificationId`, `stateVersion`, and `requiresRefetch`. It contains no Task
list, Task/Project title, comment/review/Blocked content, Watch/private
preference state, route, or relationship set.

The claimed job is locked in a short transaction, followed by the recipient
User row; current authorization is re-evaluated only after that lock wait.
Notification, NotificationUserState, minimal signal Outbox row, optional job
`NotificationId`, and `Succeeded` transition share one save/commit. Concurrent
same-user Workspace digests serialize on the recipient lock.

The existing `NotificationUserState.Version` is also an EF optimistic-
concurrency token. It protects the state version when a digest races an
immediate Task Notification that does not share the digest's recipient lock:
one unit of work commits and the other rolls back with
`DbUpdateConcurrencyException`. Digest processing maps that conflict to the
safe `DigestPersistenceConflict` retry path. A clean logical-key retry produces
exactly the two intended Notifications/signals at versions 1 and 2. The
PostgreSQL suites also prove that a post-save injected exception rolls the
whole digest transaction back and that a logical retry reuses an existing
Notification without a second signal or state advance.

A zero-candidate final evaluation is `Succeeded` with a null Notification
reference and creates no Notification or Outbox row. It is not a failure and
does not produce an empty visible digest.

## Worker and feature behavior

The worker is an in-process `BackgroundService` using public `RunOnceAsync` for
focused tests. Configured values are bounded to 100 Tenants/page, 500
schedules/page, 100 claims/batch, and 500 candidates/page. Default claim expiry
is 120 seconds and default failure retry delay is 60 seconds. Cancellation is
propagated through paging and database/generation calls. Every claim in the
bounded batch starts immediately in one `Task.WhenAll`, with its own DI and
Tenant scope; the claim-batch bound of 100 is therefore also the concurrency
ceiling. One Tenant cycle or one claimed-user generation failure does not stop
later Tenants/claims.

Worker logs pass no exception object or message. They use fixed templates and
safe bounded error codes only; focused tests reject Tenant, Workspace, user,
Task, job, and claim IDs. Diagnostics are aggregate counters without
high-cardinality labels.

`tasks.notificationsV1` remains default off. Because it is per Tenant, the
hosted worker still pages active Tenants before checking it. A disabled Tenant
performs no schedule upsert, claim, or generation. Disabling does not delete
ledger state or cancel delivery of already committed Outbox rows.

## Migration and query evidence

The focused migration adds only `task_deadline_digest_jobs` and
`task_deadline_digest_attempts`, their constraints, foreign keys, unique
identity/attempt indexes, and due/claim indexes. Fresh, upgrade, Down, and
re-upgrade paths are covered. Down removes both digest tables and therefore all
ledger history; it leaves PR07-A preferences, Notifications, Outbox, and Audit
schema intact.

Focused partial indexes are:

- `IX_task_deadline_digest_jobs_due` for pending rows ordered by Tenant,
  `NextAttemptAt`, creation, and ID;
- `IX_task_deadline_digest_jobs_claim_expiry` for claimed rows ordered by
  Tenant, expiry, and ID.

The PostgreSQL 18 suite captures `EXPLAIN (ANALYZE, BUFFERS)` and observes the
due index directly and the claim-expiry index with incremental sort. Candidate
reads are one SQL command per page, clamp a requested `int.MaxValue` page size
to 500, and preserve deterministic `(DeadlineAt, Id)` order. No optional
Task-deadline index was added because the small fixture is not representative
PostgreSQL plan evidence for that index. Production-volume candidate planning
remains environment evidence, not an inferred index recommendation.

## Focused evidence

The following runs predate the final documentation commit and are therefore
code-candidate evidence only. They must be repeated at the immutable final
HEAD before merge.

| Check | Current result | Qualification |
| --- | --- | --- |
| Release build, current code-bearing worktree | Passed: 0 warnings; 0 errors | This predates the final documentation commit and is not exact-final-HEAD evidence. |
| `Scope=TaskV1PR07C`, current code-bearing worktree with PostgreSQL 18-alpine | Passed: 72; failed/skipped: 0/0; 37 seconds | 52 non-PostgreSQL cases plus all 20 provider cases. TRX counters were 72/72 and all 43 names in `scripts/ci/task-pr07c-required-tests.txt` were present. This predates the final documentation commit and is not exact-final-HEAD evidence. |
| `TaskV1Pr07CDeadlineDigestPostgreSqlTests`, PostgreSQL 18-alpine | Passed: 10; failed/skipped: 0/0 | Fresh/upgrade/Down/re-upgrade, focused plans, bounded query count, integrated gap/fold, concurrent/expired claims, exact third failure, audited restart. Included in the 72-case scope run. |
| `TaskV1Pr07CDigestCandidateAtomicityPostgreSqlTests`, PostgreSQL 18-alpine | Passed: 9; failed/skipped: 0/0 | Current Watch/authorization/group/lifecycle filters, all four categories, recipient-lock-wait recheck, atomic generic result, concurrent digest state versions, zero result, logical retry, and injected rollback. Included in the 72-case scope run before the final documentation commit. |
| `TaskV1Pr07CNotificationVersionConcurrencyPostgreSqlTests`, PostgreSQL 18-alpine | Passed: 1; failed/skipped: 0/0 | Digest/immediate Task race: one version-1 transaction commits, one rolls back on the concurrency token, and a clean retry leaves exactly versions 1/2. Included in the 72-case scope run before the final documentation commit. |
| Full backend with PostgreSQL 18-alpine | Passed: 754; failed/skipped: 0/0; 2 minutes 41 seconds | All conditional PostgreSQL cases executed. This run followed the review fixes but predates the final documentation commit. |
| EF pending-model check | Passed: no changes since the latest migration | Executed against PostgreSQL 18 after the review fixes; not immutable final-HEAD evidence. |
| Angular regression gates | Production build passed; unit 324/324; architecture 4/4; license guard 4/4 | No frontend source changed. The production build retained three existing non-fatal budget warnings. PR07-D behavior remains unimplemented and unproved. |
| Dependency/document checks | .NET vulnerable packages: none; changed-document UTF-8/NUL/conflict validation passed | npm lockfiles are unchanged; local `npm ci` reported the existing report-only baseline of 4 moderate and 2 high findings. Hosted audit remains authoritative. |
| Exact final-HEAD Release/full backend/CI | Pending | No final immutable SHA or hosted Draft PR checks exist yet. |
| Frontend/SignalR/open behavior | Excluded | PR07-D/E scope; no claim is made. |

### Commands

The connection values used by PostgreSQL runs are disposable and must remain
redacted from durable evidence.

```powershell
$env:POSTGRES_TEST_CONNECTION_STRING = '<disposable PostgreSQL 18 connection string>'
$env:ConnectionStrings__DefaultConnection = $env:POSTGRES_TEST_CONNECTION_STRING

dotnet build AipPortal.slnx --configuration Release

dotnet ef database update `
  --project src/AipPortal.Infrastructure `
  --startup-project src/AipPortal.Web `
  --configuration Release `
  --no-build

dotnet ef migrations has-pending-model-changes `
  --project src/AipPortal.Infrastructure `
  --startup-project src/AipPortal.Web `
  --configuration Release `
  --no-build

dotnet test tests/AipPortal.Tests/AipPortal.Tests.csproj `
  --configuration Release `
  --no-build `
  --filter "Scope=TaskV1PR07C" `
  --logger "trx;LogFileName=task-pr07c-acceptance.trx" `
  --results-directory artifacts/task-pr07c-test-results

bash scripts/ci/verify-trx-results.sh `
  artifacts/task-pr07c-test-results/task-pr07c-acceptance.trx `
  --minimum-total 1 `
  --required-tests scripts/ci/task-pr07c-required-tests.txt `
  --label "TASK-V1-PR07-C"

dotnet test tests/AipPortal.Tests/AipPortal.Tests.csproj `
  --configuration Release `
  --no-build `
  --filter "FullyQualifiedName~TaskV1Pr07CDeadlineDigestPostgreSqlTests"

dotnet test tests/AipPortal.Tests/AipPortal.Tests.csproj `
  --configuration Release `
  --no-build `
  --filter "FullyQualifiedName~TaskV1Pr07CDigestCandidateAtomicityPostgreSqlTests"

dotnet test tests/AipPortal.Tests/AipPortal.Tests.csproj `
  --configuration Release `
  --no-build `
  --filter "FullyQualifiedName~TaskV1Pr07CNotificationVersionConcurrencyPostgreSqlTests"

dotnet test AipPortal.slnx --configuration Release --no-build
git diff --check
```

`POSTGRES_TEST_CONNECTION_STRING` is mandatory for every PostgreSQL claim.
Without it, local discovery skips those cases; CI fails when it is missing.
The focused provider runs above do not substitute for a final full backend run,
fresh/upgrade deployment evidence, pending-model check, or exact-head CI.

## Explicit exclusions

- Notification-open endpoint and read/navigation timing;
- delayed dispatch/replay current authorization;
- SignalR route/group/catalog changes;
- Angular preference, digest display/open, reconciliation, multi-tab,
  reconnect, degraded, active-edit, touch, or accessibility behavior;
- email and mobile push;
- PR06B and PR08;
- PR07-E alert thresholds, full runbook acceptance, broad admin UI, and final
  two-user real-backend acceptance;
- merge of the Draft PR.

## Current completion assessment

At this documentation point:

- Digest and Outbox state machines are separated in source.
- The exact three-attempt and append-preserved audited restart contracts have
  PostgreSQL evidence.
- Current candidate authorization, including a change committed during the
  recipient-lock wait, and Notification/Outbox atomicity have PostgreSQL
  evidence.
- Same-recipient digest/immediate Notification concurrency rolls one unit back
  and a clean retry produces distinct state versions 1/2 under PostgreSQL.
- Worker bounds, immediate concurrent start within the claim-batch ceiling,
  cancellation, failure isolation, default-off behavior, safe logs, and
  aggregate health are implemented and focused-tested.
- Due/claim index selection and bounded one-command candidate pages have
  PostgreSQL evidence; no speculative deadline index was added.
- Integrated PostgreSQL DST gap/fold scheduling and idempotency passed in the
  current code-bearing worktree.
- Exact-final-HEAD Release, full backend, pending-model, hosted CI, security,
  documentation, and review-thread evidence is still pending.

Therefore this source record currently says:

```text
PR07-C Complete: No
Merge: No-Go
PR07-D: No-Go until PR07-C is merged and accepted
PR07-E: No-Go until PR07-D is merged and accepted
```

These labels must be updated only from exact final evidence. A future passing
run must not overwrite the historical limitations above without identifying
its immutable head and environment.
