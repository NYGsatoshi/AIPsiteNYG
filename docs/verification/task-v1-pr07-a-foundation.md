# TASK-V1-PR07-A persistence, preferences, and dedupe foundation verification

## Status

Draft implementation evidence only. Local build, HTTP, model-consistency, full
backend, and scoped security checks are recorded below; this branch is not
merged or accepted. PR07-B remains blocked until the pull request is accepted
with the required PostgreSQL and CI evidence.

## Authority and identity

| Field | Value |
| --- | --- |
| Implementation repository | `NYGsatoshi/AIPsiteNYG` |
| Implementation base | `ca0f3fec26a78d4199fa834ce82509a6dfeda812` (`origin/main`) |
| Draft branch | `task/v1-pr07-a-notification-foundation` |
| Canonical specification PR | `NYGsatoshi/AIPsiteNYGspec#62` (merged) |
| Canonical specification commit | `8b90c8897367606473515d17d3696e458b2ee7b5` |
| Implementation owner-decision record | `docs/decisions/task-v1-pr07-owner-decisions.md` (Resolved) |
| Migration | `20260801171714_AddTaskNotificationPreferenceFoundation` |

The historical NO-GO baseline remains in
`docs/verification/task-v1-pr07-gap-audit.md`. This ledger records only the
post-resolution PR07-A implementation and does not retroactively relabel that
audit as implementation evidence.

## Delivered contract

- `Notification.LogicalKey` is nullable and bounded to 512 characters.
  `CreateOrGetByLogicalKeyAsync` has an explicit logical identity and relies on
  PostgreSQL's filtered unique index as the authority. A duplicate unique
  violation is re-read safely; unknown database failures are rethrown.
- The identity is `(TenantId, UserId, LogicalKey)` for non-null keys. Tenant,
  recipient, and caller-composed event/version/category keys remain distinct.
  Soft-deleted rows retain their key and are returned rather than resurrected;
  legacy null keys may coexist.
- Workspace members own a nullable local digest time and an independent
  optimistic-concurrency version. Workspaces own an `08:00` local-time default
  and an independent settings version. These `TimeOnly` values intentionally
  contain no timezone.
- `GET`/`PATCH /api/me/workspaces/{workspaceId}/task-notification-preferences`
  enforce current active Tenant/Workspace membership, private ownership,
  quarter-hour validation, null inheritance, typed 400/409 responses, and
  version/ETag retry metadata. General Workspace/member DTOs omit the private
  fields.
- `tasks.notificationsV1` is centrally registered and default disabled. It is
  not used to disable authorization, privacy, or dedupe.

## Migration and rollback safety

The migration adds only `notifications.LogicalKey`, its filtered unique index,
the two Workspace fields, and the two WorkspaceMember fields. A non-null
Workspace default backfills existing rows to `08:00`; existing member
preferences are null and their initial version is 1. Existing Notification
rows retain null keys.

The Down path drops only the added index/columns and preserves pre-existing
rows. Values stored only in the added columns are naturally lost if the Down
migration is applied; deployment rollback therefore requires accepting that
new preference/logical-key state is removed. It makes no table recreation,
rename, or unrelated cleanup.

## Explicitly excluded

- Task notification producers and `DeadlineAt` mutation/classification;
- digest ledger, worker, scheduling, and DST processing;
- a new semantic Outbox event family (the existing Notification service
  behavior remains available only when its new primitive is invoked);
- SignalR route or dispatch-authorization changes, notification-open endpoint,
  and Angular preference/notification behavior;
- PR06B and PR08 work.

## Focused evidence

| Check | Result in this worktree | Notes |
| --- | --- | --- |
| `dotnet build AipPortal.slnx --no-restore -v:minimal` | Passed, 0 warnings / 0 errors | Compiles Domain, Application, Infrastructure, Web, and tests. |
| `dotnet test ... --filter "FullyQualifiedName~HttpTenantIsolationTests"` | Passed: 30 | Covers active GET/PATCH, null inheritance, 00:00/00:15/23:45, invalid times, typed conflict/retry, isolation, revoked membership, and DTO privacy. |
| `dotnet ef migrations has-pending-model-changes ... --no-build` | Passed | No model changes since the focused migration. |
| `dotnet ef migrations script 20260730120626_AddCanonicalGanttVersions 20260801171714_AddTaskNotificationPreferenceFoundation ... --no-build` | Passed | Script contains only the additive columns and the filtered logical-key unique index before the migration-history insert. |
| `dotnet test ... --filter "FullyQualifiedName~TaskV1Pr07NotificationFoundationPostgreSqlTests"` | Compiled; 5 conditionally skipped | `POSTGRES_TEST_CONNECTION_STRING` is absent locally. The suite covers fresh/upgrade/down migration, filtered index/defaults, concurrent dedupe, tenant/recipient/event/version/category separation, soft-delete semantics, legacy null keys, and PostgreSQL preference winner/loser/retry. |
| `dotnet test AipPortal.slnx --no-restore --configuration Release` | Passed: 416; skipped: 89; failed: 0 | All local backend regressions passed. The five PR07-A PostgreSQL tests are among the skips because the connection string is absent. |
| Scoped Codex Security scan | Complete; 0 reportable findings | Scoped to 28 PR07-A production/control files; tenant scope, active membership, concurrency, privacy, logical-key recovery, soft-delete replay, and rollout boundary were reviewed. PostgreSQL execution remains an environmental limitation. |
| Exclusion-path and whitespace check | Passed | `git diff --check` passed; no frontend, hosted artifact, new producer/digest-worker, or realtime-route path changed. |
| Active-document local Markdown links | Passed | All local Markdown links in the changed active documentation resolve; the repository has no dedicated documentation-lint command. |
| Pull-request CI | Passed | GitHub Actions run `30711182611` applied PostgreSQL migrations and passed 505 tests with 0 failures; Documentation, npm audit, security scan, backend/frontend, and code-quality gates also succeeded. The draft still requires merge/acceptance before PR07-B. |

No local result that reports PostgreSQL tests as passed/skipped without
`POSTGRES_TEST_CONNECTION_STRING` is treated as PostgreSQL provider evidence.

## PR07-B entry gate

PR07-B may begin only after this draft is merged and accepted from current
`main`, all required fresh/upgrade PostgreSQL migration and uniqueness/
concurrency checks are green, the preference routes retain their exact private
contract, the feature key remains disabled by default, and no excluded Task,
digest, Outbox, SignalR, or Angular behavior is introduced by this PR.
