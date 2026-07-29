# TASK-V1-PR05 verification record

## Candidate identity

- Implementation base:
  `b6c848025f64918ad622fde7433ba91f1c36789f`
- Specification:
  `20aa5a2e015ae8fb68e5ba2b257a416dfcad5c3f`
- Branch: `task/v1-pr05-kanban-adapter`
- Scope: TASK-V1-PR05 only

The exact final candidate SHA and final-head command results are recorded in
the draft pull request because committing this document assigns that SHA.

## Verification boundaries

The local acceptance set covers:

- Application authorization, privacy, Task/board concurrency, transition
  guards, WIP warnings, stable reorder/rebalance, audit, and atomic rollback.
- PostgreSQL 18 empty migration, upgrade from the PR04 migration, additive
  down migration, pending-model check, expected Kanban indexes, bounded
  projection, stable reload, fixed six-statement query shape, and atomic
  Task/board and Stage/board concurrency rollback.
- Angular DTO mapping, Project Detail state, optimistic move, denial rollback,
  conflict refetch, queued realtime reconciliation, reconnect catch-up,
  authorization clearing, authorization-epoch response discard, configuration,
  feature fallback, and stale My Tasks preference normalization.
- Adapter keyboard movement, Escape/cancel, logical focus restoration,
  permission-hidden actions, swimlanes, WIP text, and narrow presentation.
- Desktop and mobile Chromium flows for pointer move, keyboard move, conflict,
  denial rollback, WIP warning, Task Detail activation, narrow layout,
  permission denial, and feature fallback.
- Release build, Angular production build, architecture import checks, license
  policy tests, initial-bundle inspection, and complete forbidden-path audit.

Mocked Angular Playwright proves browser behavior against the public wire
shape; it does not replace controller/ASP.NET Core integration evidence.
PostgreSQL tests use real EF migrations and Npgsql but do not represent
production data volume.

The pinned Linux screenshot command and real-backend browser stack remain
environment-dependent. Exact final-head results and any environmental blockers
are recorded in the draft pull request without converting them into passing
evidence.

## Migration evidence

Migration: `20260729140506_AddProjectKanbanDefaultSwimlane`

- Empty PostgreSQL apply: covered.
- Upgrade from `20260729010000_AddMyTasksEffectiveWatchIndex`: covered with a
  pre-existing Workflow Definition row.
- Existing-data result: `KanbanDefaultSwimlane = None`.
- Additive down migration: covered; the pre-existing board definition and
  version remain.
- Model snapshot/pending changes: covered.

The migration does not rewrite Task Stage or order data. Disabling
`tasks.kanbanV1` is the presentation rollback; it preserves canonical HTTP
state and returns Project Detail to the maintained Task List.

## Security and architecture assertions

- Feature flags do not participate in backend authorization.
- Tenant query filters and Project authorization precede board projection.
- Unknown, revoked, and unauthorized Project access use the same safe
  not-found result.
- Cross-Project and unknown neighbor IDs use the same position error.
- Counts, warnings, parent context, and filter results contain only authorized
  Project data.
- Unsafe browser commands use the existing CSRF interceptor.
- Transactional Outbox rows and audit records share the mutation commit.
- HTTP command/snapshot results are authoritative; realtime carries
  invalidation only.
- Project feature code uses AIPsite-owned models and adapter contracts.
- No package, lockfile, Angular config, route, AppShell, global style, CI,
  Workspace, Messaging, Gantt command, or legacy `wwwroot` file is changed.
