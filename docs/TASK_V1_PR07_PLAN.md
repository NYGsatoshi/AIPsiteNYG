# TASK-V1-PR07 sequential implementation plan

Status: Proposed; implementation is blocked by `docs/decisions/task-v1-pr07-owner-decisions.md`.

Implementation baseline audited: `491d17db3701b7fb26010db8c0590eac7d24bd78`

Canonical specification audited: `6e8e5c3651adeedc7a2709124e9af0fd927d35b5`

## Objective

Implement the canonical Task in-app immediate notifications, Workspace deadline-digest preference and daily digest, transactional semantic Outbox events, authorized SignalR delivery/opening, and Angular reconciliation using the repository's existing Task, Notification, Outbox, realtime, Workspace-timezone, and shared frontend state owners.

Implementation uses one sequential lane:

```text
owner/spec decisions
        |
        v
PR07-A -> PR07-B -> PR07-C -> PR07-D -> PR07-E
```

No two phases should be developed on simultaneous branches that edit overlapping Task, Notification, Outbox, realtime, Workspace settings, or Angular state.

## Scope boundary

Included:

- immediate in-app Task notification policy;
- server-authoritative `DeadlineAt` major-change classification;
- per-user/per-Workspace digest preference and Workspace default;
- Workspace-local daily digest builder/scheduler/idempotency;
- PR07 semantic events through the existing transactional Outbox;
- current-authorized user/Project/Workspace and, if required, Group SignalR routing;
- authorized notification opening and existing Angular surface reconciliation;
- PR07 health, metrics, runbook, PostgreSQL/HTTP/SignalR/Real Backend evidence.

Excluded from every phase:

- PR06B large-project Gantt pagination/virtualization and any change to the current 500/2,000 fail-closed limits;
- PR08 integration/cutover work;
- email/mobile push;
- ordinary-comment notify-all;
- Presence, Typing, calls, public Hub, separate feature sockets;
- Project-specific digest time;
- automatic schedule movement, recurring/personal Tasks, Calendar/Scheduler;
- Critical Path, Baseline, Resource Leveling, cross-Project dependencies/move;
- Messaging message-body delivery or reuse of Messaging payloads as Task notifications;
- broad admin UI, legal hold/discovery, broad notification export.

## Required decision gate

Before PR07-A begins, the canonical specification must record:

1. exact mandatory recipients for the unresolved immediate categories;
2. allowed digest local-time granularity/range;
3. the generic BackgroundJob versus realtime Outbox/digest retry, lease, terminal-state, and replay boundary.

The recipient and worker-profile answers affect later phases, but the granularity answer directly affects PR07-A's PATCH validation and UI contract. Keeping PR07-A whole is safer than landing an unused schema-only migration.

## PR07-A — Contract foundation, preferences, and dedupe primitives

### Goal

Land additive persistence and API contracts that later notification/digest producers can use without enabling any Task notification generation or scheduled dispatch.

### Included scope

- Add a nullable bounded logical notification key to `Notification`.
- Add a unique filtered database constraint on `(TenantId, UserId, LogicalKey)` for non-null keys.
- Extend `INotificationService`/`DbNotificationService` with an explicit logical-key creation method that returns the existing row on a duplicate. Keep current legacy creation behavior for legacy callers until PR07-B normalizes them.
- Add nullable Task deadline digest local time and an independent preference version to `WorkspaceMember`.
- Add Workspace default Task deadline digest local time (`08:00`) and an independent settings version to `Workspace`.
- Add application DTOs/use case and exact routes:
  - `GET /api/me/workspaces/{workspaceId}/task-notification-preferences`
  - `PATCH /api/me/workspaces/{workspaceId}/task-notification-preferences`
- Return stored nullable value, effective inherited value, Workspace timezone identity, and version/ETag without exposing another member's state.
- Validate current Tenant/active Workspace membership, the decided time granularity/range, and optimistic concurrency.
- Add a central PR07 feature key such as `tasks.notificationsV1`, default disabled, through the existing feature registry only. The flag may gate production generation/scheduling but never bypass authorization, privacy, or dedupe.
- Document the approved recipient/time/worker decisions in active API/operations documentation as applicable.

### Explicit exclusions

- no Task notification producers;
- no `DeadlineAt` mutation/classifier;
- no digest ledger or worker;
- no new semantic event emission;
- no SignalR route change;
- no Angular preference or notification behavior.

### Expected components

- Domain: `CommunicationEntities.cs`, `WorkspaceEntities.cs`.
- Application: notification service contract, a focused Task notification-preference use case/DTOs, feature-key registry.
- Infrastructure: `DbNotificationService`, `WorkspaceConfigurations`, communication configuration, repositories/DI.
- Web: a thin preference controller or appropriately scoped current-user controller.
- Tests: notification/preference unit, HTTP, migration, and conditional PostgreSQL tests.

### Migration impact

One focused migration and snapshot update:

- nullable Notification logical key plus unique filtered index;
- WorkspaceMember preference/time/version fields;
- Workspace default/time settings version with an `08:00` backfill/default.

No digest ledger yet. Existing rows remain valid and existing notification callers can leave the key null.

### API impact

Two additive current-user preference routes. PATCH uses a version/ETag and typed validation/conflict errors. No existing route changes.

### Event/frontend impact

No new production event and no frontend behavior. A preference-changed event constant may be reserved only if a compile-time catalog design requires it; it must not be emitted before its consumer/authorization exists.

### Tests

- fresh and upgrade migration, including existing duplicate legacy notifications;
- concurrent same logical key creates/returns one visible row;
- distinct event/version/category creates a distinct row;
- soft-deleted logical row is not resurrected by retry;
- current active member GET/PATCH, nullable inheritance, decided granularity boundaries;
- another Workspace/Tenant/member ID denial with safe errors;
- revoked/expired membership denial;
- optimistic concurrency winner/loser and retry;
- general Workspace/member DTOs do not expose private preference fields.

### Rollback/flag behavior

The feature remains disabled. Code is backward-compatible with nullable columns. Rollback after preference writes loses user/default settings; it must be done only with the feature disabled and explicit data-loss acceptance.

### Dependency/completion gate

Depends on all owner/spec decisions, especially digest granularity. Complete only when migration upgrade/fresh-schema and PostgreSQL uniqueness/concurrency evidence pass and no Task notification is generated.

## PR07-B — Immediate policy, hard-deadline classification, and Task event production

### Goal

Generate every immediate notification intent and safe Task semantic event inside the canonical business transaction, using the PR07-A logical key and the approved recipient matrix.

### Included scope

- Add a central application recipient-policy service using current canonical Task relationships and authorization.
- Integrate Primary Assignee assigned/removed, Reviewer assigned, direct mention, Blocked, Review submitted, Review returned/rejected, major hard-deadline, and Important TaskComment into `TaskCommandService`/`TaskSubresourceService`.
- Capture pre-mutation recipients before relationship removal/change.
- Keep mandatory categories independent from Watch; add Watch-derived general activity only if explicitly approved and feature-gated.
- Apply actor suppression centrally.
- Add versioned `DeadlineAt` mutation through the canonical Task update contract; do not add it to Gantt planning commands.
- Implement `Added`, `Removed`, `ShiftAtLeast24Hours`, `CrossedUrgencyBoundary`, and `None` from persisted old/new values plus `TaskWorkspaceTimeZoneResolver`.
- Return safe classification metadata and write safe AuditLog metadata only.
- Register/produce the selected canonical semantic event families and retain `Projects.TaskChanged.v1` as the common broad invalidation where needed.
- Normalize compatibility assignment paths to avoid double/wrong notifications and remove or guard legacy Task notify-all behavior.
- Persist the notification intent row, user-state change, business semantic Outbox row, and notification signal Outbox row in the same database transaction as the Task mutation. The intent becomes visible and the Outbox becomes dispatchable only after that transaction commits; a failed save commits none of them.

### Explicit exclusions

- no digest builder/worker;
- no notification-open endpoint;
- no SignalR group/routing changes;
- no Angular changes;
- no email/push.

### Expected components

- `TaskCommandService`, `TaskSubresourceService`, compatibility sections of `ProjectService`.
- New focused application policy/classifier contracts and implementations.
- Notification service logical-key API.
- `RealtimeContracts` catalog, transactional payload validation, business publisher.
- Task/notification unit and PostgreSQL/hosted HTTP tests.

### Migration/API/event impact

- Migration: none expected; measure existing DeadlineAt indexes before adding any.
- API: additive `DeadlineAt` field in the canonical versioned Task detail mutation/response classification; exact existing error envelope retained.
- Events: safe semantic Task families plus existing `Notifications.NotificationCreated.v1`. No comment text, review reason, Watch state, preference value, or restricted title in broad events.
- Frontend: none; rollout flag remains disabled so current users do not receive half-integrated visible behavior.

### Tests

- every category and approved recipient set, including previous assignee;
- actor skip and self-assignment/mention cases;
- ordinary comments create no visible notification;
- invalid/cross-scope mentions fail safely without identity/content disclosure;
- Watch opt-out suppresses only Watch-derived activity;
- each deadline boundary case from the audit;
- same logical retry and concurrent writers produce one Notification;
- stale version, authorization denial, audit failure, and database failure roll back Task/Notification/Outbox together;
- compatibility and canonical routes cannot double notify;
- payload/log assertions prove forbidden data absent.

### Rollback/flag behavior

Keep `tasks.notificationsV1` disabled until PR07-D completes open/routing/UI. Disabling stops new PR07 intents but does not delete existing Notification/Outbox rows. Consumers remain backward-compatible with generic TaskChanged.

### Dependency/completion gate

Depends on PR07-A and approved recipient policy. Complete only with PostgreSQL transaction/dedupe/isolation evidence and exact event catalog documentation.

## PR07-C — Workspace deadline digest worker and idempotency

### Goal

Build bounded, independently retryable daily user/Workspace digests without duplicating visible notifications or misusing the Outbox as a scheduler.

### Included scope

- Add a digest delivery/claim ledger with unique user/Workspace/local-date/policy-version identity.
- Add a bounded BackgroundService or the approved existing job abstraction after the worker-profile decision.
- Select due user/Workspace rows in bounded pages, using Workspace-local time and a documented DST gap/fold policy.
- Build current authorized Task groups for 3 days, 1 day, today, and overdue.
- Recheck membership, Workspace/Project/Task visibility, deletion/archive, completion/cancellation, and current relationship relevance immediately before notification creation.
- Create one generic visible digest Notification and transactional Outbox signal; do not embed the candidate Task list in the signal.
- Isolate each user/Workspace unit of work, implement approved retry/terminal/restart semantics, and emit metadata-safe health/metrics.
- Add operator documentation for due/running/succeeded/failed/terminal states.

### Explicit exclusions

- no email/mobile push;
- no broad Task list in payload/log;
- no Project-specific time;
- no frontend display/open/preference control;
- no reuse of `outbox_events` as job candidates.

### Expected components

- New digest ledger entity/configuration/repository.
- New application digest eligibility/builder service.
- New Web hosted worker and options/diagnostics.
- Existing Task queries/timezone resolver, Notification service, transactional Outbox.
- Operations/configuration docs and focused tests.

### Migration/API/event impact

- Migration: new digest ledger and unique/due/claim indexes; add a Task deadline query index only if PostgreSQL plan evidence requires it.
- API: no new route beyond PR07-A.
- Event: `Notifications.TaskDeadlineDigestReady.v1` or the approved user refetch signal; no broad route.
- Frontend: none; feature remains disabled.

### Tests

- four groups and exact local-date boundaries;
- multiple Workspaces/timezones for one user;
- DST nonexistent/repeated local time, timezone change, restart, and no double/permanent skip;
- revoked/expired membership and deleted/archived/completed/cancelled/no-longer-related Task exclusion at claim/build/commit;
- bounded pages and one-user failure isolation;
- concurrent workers/lease expiry/retry/terminal/restart per approved profile;
- unique ledger and Notification key under retry;
- safe metrics/logs and query-count/plan evidence.

### Rollback/flag behavior

Worker starts inert while the feature is disabled. To roll back after enablement: disable scheduling, let in-flight claims expire/finish, record terminal ledger state, and retain ledger/Notification/Outbox rows until the code no longer references them.

### Dependency/completion gate

Depends on PR07-A, PR07-B's notification creation semantics, and `PR07-OWNER-003`. Complete only with PostgreSQL concurrency and DST evidence plus an operator-readable health state.

## PR07-D — Authorized delivery/opening and Angular reconciliation

### Goal

Make delayed/replayed delivery and notification opening current-authorized, then expose the complete behavior through the existing Angular state owners and one shared realtime client.

### Included scope

- Extend `RealtimeDispatchAuthorizer` with event-specific Task/notification target resolution for user and Workspace routes.
- Reduce NotificationCreated payload to safe refetch metadata; do not republish stored display content.
- Make Workspace archive paths, including `WorkspaceService.ArchiveAsync` and `AdminService.ArchiveWorkspaceAsync`, publish/trigger the existing authorization-state invalidation for affected current members so protected client state clears promptly.
- Add server-derived Group subscription/dispatch authorization only if the approved catalog actually routes a PR07 event by Group. Otherwise explicitly constrain PR07 to Project/user routes and test that no Group target is emitted.
- Add a recipient-owned notification-open use case/endpoint that reauthorizes current target, returns an authorized current route or a uniform unavailable result, and preserves click-to-read semantics.
- Handle active, deleted, archived, revoked, unsupported-move, unknown, and digest targets.
- Extend existing `RealtimeFacade` event validators/stale guards; retain one connection.
- Extend RightPanel for logical-key/event dedupe, digest display, open outcomes, safe unavailable state, and one HTTP-plus-event visible update.
- Add Workspace-specific preference UI using PR07-A API.
- Map semantic invalidations into the existing Task Detail, My Tasks, Project Detail, Kanban, and Gantt coalescing/edit-preservation flows.
- Keep degraded indicator/manual HTTP refresh and clear protected preference/notification/Task projections before reauthorization.

### Explicit exclusions

- no new socket client;
- no direct SignalR group-name construction in Angular;
- no PR06B Gantt pagination/virtualization;
- no new digest scheduler behavior;
- no broad payload display fields.

### Expected components

- Web realtime authorizer/Hub/registry only where required.
- Notification application service/controller/open target resolver.
- `frontend/src/app/core/realtime/*` and the existing RightPanel/Workspace/Project facades/components.
- Backend Hub/dispatcher tests plus Angular unit/component tests.

### Migration/API/event/frontend impact

- Migration: none expected.
- API: one additive notification-open endpoint; PR07-A preference routes consumed.
- Events: consumers/authorization for PR07-B/C events; no duplicate event families.
- Frontend: user-visible notifications, digest/open behavior, preference UI, and reconciliation. Enablement remains controlled until PR07-E evidence passes.

### Tests

- delayed enqueue then membership revoke or Workspace archive before dispatch/open;
- dead-letter/replay after revoke;
- authorized user/project/workspace and Group-or-explicit-non-use routing;
- no broad private/restricted payload fields;
- notification open matrix and read-state behavior;
- HTTP response plus duplicate/replayed event produces one visible change;
- stale versions, bounded coalescing, multi-tab duplicate events;
- reconnect reauthorization/catch-up/denial clearing;
- active edits remain visible across Task/Kanban/Gantt;
- accessible preference/digest UI, narrow/touch, dark/light.

### Rollback/flag behavior

With the flag disabled, HTTP notification lifecycle and manual refresh remain. Disabling realtime does not disable HTTP authorization or dedupe. Existing generic events remain supported through the deployment compatibility window.

### Dependency/completion gate

Depends on PR07-A-C. Complete only when real server routing authorization and all frontend state owners pass focused tests without separate sockets.

## PR07-E — Operations, Real Backend acceptance, and integration evidence

### Goal

Close operational and end-to-end evidence before PR07 is eligible for enablement or PR08 entry.

### Included scope

- Extend health/metrics with Task event failures, logical-dedupe suppression, digest due/running/succeeded/failed/terminal counts, per-Workspace lag, invalid timezone/preference counts, and authorization suppression counts.
- Add metadata-safe structured logging and alert thresholds.
- Complete a safe Outbox/digest replay/restart runbook using existing operator conventions; no broad admin UI.
- Add Real Backend two-user Task flows for assignment/review/mention/Important/Blocked/deadline, Watch independence, digest/open, revocation, duplicate/stale/replay, and disconnect/reconnect.
- Run full relevant backend/frontend/UI validation, including authoritative Linux screenshots where baselines change.
- Update active architecture/testing/operations/status documentation to match verified behavior.

### Explicit exclusions

- no new product category or recipient policy;
- no PR06B or PR08 cutover;
- no email/push or broad admin dashboard.

### Expected components

- `Program.cs` health/metrics, realtime/digest diagnostics, safe logging.
- `docs/OPERATIONS.md`, active architecture/testing/status docs.
- `tests/AipPortal.Tests` hosted PostgreSQL/SignalR suites and `tests/ui` Real Backend flows.

### Migration/API/event/frontend impact

No planned schema or product API change. Any discovered contract defect returns to the owning earlier phase rather than being hidden in an observability PR. Frontend changes are test/diagnostic/accessibility fixes only.

### Tests and completion gate

- `dotnet test AipPortal.slnx` with explicit reporting of PostgreSQL environment;
- `npm --prefix frontend test`;
- `npm --prefix frontend run build`;
- focused Real Backend Compose flows;
- `npm run test:ui:angular:docker` for authoritative screenshot parity if visual baselines change;
- health/runbook failure and replay drills.

Complete only when all required evidence is source-linked, flags can be enabled without authorization/dedupe bypass, and no protected values appear in logs/events/errors.

## Migration strategy

Use two additive, focused migrations:

1. PR07-A: notification logical identity plus Workspace member/default preference state.
2. PR07-C: digest delivery/claim ledger and only evidence-required query indexes.

Do not combine either with unrelated schema cleanup. Validate fresh and upgrade schemas. Deployment order is migration, backward-compatible code with feature disabled, worker/consumer compatibility, then evidence-based enablement. Never roll back the database while enabled code or in-flight workers depend on the added columns/tables.

## API strategy

- Preserve existing notification list/read/delete routes.
- Add only the two canonical preference routes, one authorized open endpoint, and a `DeadlineAt` field in the existing canonical versioned Task mutation contract.
- Keep controllers thin and all current user/Tenant/Workspace/Task checks in application use cases.
- Use the existing typed error envelope and safe 403/404 policy.
- Do not return private preference state in general Workspace/member DTOs.
- Do not return target details from a denied notification open.

## Outbox and realtime strategy

- Every Task notification/event intent is added before the same `SaveTaskCommandAsync` that commits the business mutation.
- Digest ledger claims are not Outbox events. A built visible notification and its user signal use the existing Outbox.
- Keep `Projects.TaskChanged.v1` as the stable broad invalidation and add distinct canonical semantic families only where their routing/consumer meaning differs.
- Keep broad events metadata-only; user-specific Notification events become refetch signals.
- Reauthorize current resource access at delayed dispatch/replay and HTTP open; delivery itself never authorizes HTTP access.
- Retain at-least-once transport plus event-ID client dedupe and database-enforced visible-notification dedupe.

## Frontend strategy

- Keep `RealtimeFacade` as the only transport and catch-up owner.
- Keep HTTP as authoritative for RightPanel, Task Detail, My Tasks, Project Detail, Kanban, and Gantt.
- Extend current stale-version guards, refetch coalescing, authorization clearing, conflict preservation, degraded indicator, and manual refresh.
- Store no preference only in browser state and construct no SignalR group names in features.

## Feature flags and rollout

Add at most one centralized Task-notification rollout key through the existing registry. Default it off through PR07-A-D. Existing `realtime.signalR` and `communication.transactional_outbox.enabled` continue to govern their infrastructure, but neither is authorization or dedupe. PR07-E may recommend enablement; actual PR08 integration/cutover remains separate.

## Rollback strategy

- Disable new Task notification/digest production first; never disable authorization/dedupe checks independently.
- Stop new digest claims and allow/expire current claims before worker rollback.
- Continue consuming already-written supported Outbox schemas during a compatibility window.
- Preserve Notification logical keys and digest ledger rows so retry/rollback does not duplicate visible results.
- Use forward fixes for persisted-data defects; down migrations are only safe before feature use or with explicit data-loss handling.
- HTTP/manual refresh remains the functional fallback when SignalR is disabled/degraded.

## PR06B exclusion

PR06B issue #270 is outside every PR07 phase. The current Gantt bounds remain 500 combined canonical WorkItems/Milestones and 2,000 active same-Project dependencies, with typed HTTP 400, fail closed, no silent truncation, and no partial successful snapshot. No phase changes pagination, virtualization, adapter limits, or PR06 acceptance behavior.

## PR08 entry conditions

PR08 may begin only after PR07-E proves:

- all owner decisions are canonical and implemented;
- immediate recipient, dedupe, three-point authorization, and deadline classifier tests pass;
- digest idempotency/timezone/DST/worker health pass;
- Outbox delivery/replay is current-authorized and observable;
- shared-client reconnect/catch-up and protected-state clearing pass on a real backend;
- preference/digest/open UI is accessible and Workspace-specific;
- PR07 flags have a documented safe enable/disable procedure;
- PR06B remains separate and no PR08 cutover code was pulled into PR07.

## Recommended first implementation scope

After the three owner/spec decisions are merged, generate PR07-A exactly as defined above: one additive persistence migration for notification logical identity and Workspace member/default preference state; the two canonical preference APIs with active-membership, privacy, decided time validation, and optimistic concurrency; a logical-key notification creation primitive; focused migration/PostgreSQL/HTTP tests; and a disabled centralized rollout key. It must contain no Task notification generation, no deadline classifier, no digest ledger/worker, no semantic event emission, no SignalR routing change, and no Angular behavior.
