# Database

Last implementation audit: 2026-07-30.

## Technology

- PostgreSQL.
- EF Core 10.
- Npgsql EF Core provider.
- One `AppDbContext` in `src/AipPortal.Infrastructure/Persistence/AppDbContext.cs`.

The runtime requires `ConnectionStrings:DefaultConnection`; infrastructure registration throws when it is absent.

## Schema sources of truth

Use these in order:

1. `AppDbContext` DbSets.
2. Entity classes under `src/AipPortal.Domain/Entities/`.
3. Fluent configurations under `Infrastructure/Persistence/Configurations/`.
4. `Infrastructure/Persistence/Migrations/AppDbContextModelSnapshot.cs`.
5. Applied database migration history in the target environment.

`docs/DATA_MODEL.md` is a human-readable field inventory, not the authoritative schema.

## Migration history

There are forty timestamped EF migration classes as of 2026-07-30, from:

- `20260606135558_InitialCreate`
- through `20260730120626_AddCanonicalGanttVersions`

Migration files live in `src/AipPortal.Infrastructure/Persistence/Migrations/`.

The application does not auto-migrate. `/health/ready` fails when pending migrations exist.

## Model groups

### Platform and tenancy

- Tenant, TenantSettings
- Plan, Subscription, UsageRecord
- TenantUser
- ExportJob
- IntegrationAccount, WebhookEndpoint, ApiToken

### Identity

- User, Session, Invite

### Organization and communication

- Workspace, WorkspaceMember
- Group, GroupMember
- Channel, ChannelMember
- Post, PostThread
- Conversation, ConversationMember, Message, MessageAttachment, ReadState
- Announcement, AnnouncementRead, Notification

### Events and forms

- ActivityEvent, EventAttendance
- InternalForm, FormQuestion, FormResponse, FormAnswer

### Projects and files

- Project, ProjectMember, Milestone
- TaskItem, TaskDependency, TaskAssignment
- TaskWorkflowDefinition and TaskWorkflowStage, including one Project Kanban
  display default and warning-only Stage WIP limits
- ActivityLog, Comment, Feedback
- Artifact, ArtifactVersion
- FileObject, Attachment, FileScanResult

### TASK-V1-PR05 Project Kanban

Migration `20260729140506_AddProjectKanbanDefaultSwimlane` adds the
non-null, string-converted `KanbanDefaultSwimlane` property to
`task_workflow_definitions`, defaulting existing definitions to `None`.

Kanban reuses canonical persistence:

- `TaskWorkflowStage.SortKey` is column display order.
- `TaskWorkflowStage.WipWarningLimit` is warning-only configuration.
- `TaskItem.WorkflowStageId` is card Stage.
- `TaskItem.SortKey` is stable card order.
- Task and Workflow Definition versions remain optimistic concurrency tokens.

No vendor board or card table exists. The board query uses the current
Tenant filter, Project scope, existing Stage/Task indexes, bounded card
projection, and one batched direct-child aggregate for canonical parent
summary values.

### TASK-V1-PR06 Canonical Project Gantt

Migration `20260730120626_AddCanonicalGanttVersions` adds:

- non-null `Project.VersionNo bigint`, default 1; and
- non-null `Milestone.VersionNo bigint`, default 1.

Both are EF optimistic concurrency tokens. Canonical Tasks and Workflow
Definitions already had version tokens; PR06 does not add another Task or
dependency version store.

The migration performs no Task progress or other domain-data update. Its
additive Down path removes only the two new version columns and preserves
existing Project, Milestone, Task, and dependency rows.

PR06 continues to reuse canonical persistence:

- `TaskItem.PlannedStartDate` and `TaskItem.PlannedEndDate` remain authoritative
  day-precision Task planning values. Maintained legacy `StartDate`/`DueDate`
  columns are synchronized for the flag-disabled compatibility view.
- `TaskItem.ProgressPercent`, Workflow Stage, Blocked state, hierarchy,
  priority, and primary-assignee relationship remain shared with List, My
  Tasks, and Kanban.
- Parent dates and progress are derived only from direct, non-deleted canonical
  Task-kind children and are never stored in a Gantt-owned parent row.
- Compatibility `Milestone.DueDate` is its zero-duration date. The nullable
  legacy column is retained; PR06 commands require a date and the snapshot
  warns on pre-existing null rows.
- `TaskDependency` remains the only dependency persistence. PR06 authors
  same-Project Finish-to-Start edges only and retains legacy non-FS rows as
  read-only warning inventory. Bounded dependency reads filter both ends to
  active same-Project canonical Task rows.
- `DeadlineAt` remains a separate UTC timestamp and is not updated by Gantt
  schedule commands.
- AuditLog and transactional Outbox rows share the same EF command save as
  schedule, progress, Milestone, and dependency mutations.

Terminal parent/child behavior is an Application invariant, not new schema:
Done/Cancelled parents reject new subtasks until reopened, terminal children
cannot reopen under a terminal parent, and parent Done requires terminal direct
Task children plus derived progress 100. All-cancelled children derive progress
0 and therefore cannot complete the parent as Done. Review override completion
uses that same guard; restore and delete of a child under a terminal parent are
also rejected until the parent is reopened.

Task lifecycle and dependency mutations that can change the visible Project
graph advance the shared `Project.VersionNo` in the same transaction. That
aggregate revision makes a concurrent Task-delete/dependency-add race fail as
an optimistic concurrency conflict. PostgreSQL regression coverage verifies
that no stale dependency edge is committed. Visible dependency rejections are
audited with metadata-safe reason codes and do not persist hidden-neighbor
metadata.

No Gantt-specific schedule, progress, calendar, vendor Task, or dependency
table was added. No PR06 index was added: the projection uses the existing
Tenant/Project/task/dependency relationships and bounds the graph before row
materialization.

The repository snapshot projection performs seven measured, deterministic,
set-based SQL commands:

1. Project identity/version;
2. Task count;
3. Milestone count;
4. Workflow version;
5. bounded Tasks with reference joins for Stage and primary assignee;
6. bounded Milestones; and
7. bounded same-Project dependencies.

This seven-command count is intentionally scoped to
`PlanningRepository.GetGanttAsync`. The authorized real Kestrel/PostgreSQL
snapshot is separately measured and asserted at exactly 24 commands total:
tenant resolution, cookie/session authorization, membership and timezone
lookups, plus the seven projection commands. The bounded query shape has no
row-per-item N+1 path. An item-overflow response stops after the two counts plus
Project lookup and does not load Task rows or the dependency graph. The
repository also rechecks the combined Task/Milestone row count after the
bounded reads, closing the PostgreSQL READ COMMITTED insert race between the
initial counts and materialization.
The provisional item bound counts 500 canonical Task-kind WorkItems plus canonical
Milestones, consistently across snapshot, schedule, progress, and dependency
paths; the dependency bound is 2,000. Their canonical owner decision remains
open. Owner input for both bounds and overflow behavior is `UNRESOLVED`; these
values are implementation safeguards only, are not owner-approved, and are
not a formally approved numeric contract. `DECISION REQUIRED` remains open.
Overflow is currently rejected and never silently truncated.

Latest-main code-bearing candidate
`1abce6c70d9f665b773d35f75d63c0d05a387cc8` repeated focused PostgreSQL 18.4
integration evidence: it applied the migration to an empty database, upgraded
the PR05 migration, migrated down additively, and reported no pending
migrations/model changes. The focused tests captured exact SQL in xUnit
evidence and asserted the seven-command repository projection and 24-command
authorized HTTP total, deterministic order/limits, cancellation, and no N+1 or
unbounded graph load. They also exercised the post-read count race, Project and
Milestone concurrency, and the Project-revision Task-delete/dependency-add
race. The fixture is intentionally small, so no `EXPLAIN` claim or index-plan
claim is made. Evidence is recorded in
`docs/verification/task-v1-pr06-gantt.md`; exact final-HEAD Hosted evidence is
pending the documentation commit.

### System and UI shell

- AuditLog, SecurityEvent, SystemSetting
- FeatureModule, PanelDefinition, UserLayout
- CommandDefinition, RadialMenuProfile, RadialMenuItem

## Tenant ownership

Tenant-owned records implement `ITenantEntity`.

`AppDbContext`:

- adds a required `TenantId`;
- adds a `TenantId` index;
- applies a global query filter;
- stamps new tenant-owned entities when `TenantId` is empty;
- rejects mismatched tenant writes;
- rejects normal tenant-owned writes when the current tenant is not active.

Platform scope bypasses filters. Any `IgnoreQueryFilters` usage must include an explicit tenant predicate or another reviewed platform boundary.

Known bypass locations include tenant repositories, tenant plans, integrations, and tenant export repositories. Re-audit them when changing tenancy behavior.

## Non-tenant tables

Some tables are intentionally platform/global, including:

- User
- Session
- Plan
- SystemSetting
- FeatureModule
- PanelDefinition
- CommandDefinition

Global tables can still reference tenant-owned tables. Review relationship and authorization implications before adding cross-scope queries.

## IDs, enums, timestamps, and deletion

- Primary IDs are GUIDs.
- Enums are generally stored as strings through Fluent API conversion.
- `AuditableEntity` provides created/updated timestamps.
- `SoftDeletableEntity` adds deletion timestamp, actor, and reason.
- Foreign-key delete behavior is mostly `Restrict` or `SetNull`.
- Application lifecycle operations often combine status changes with soft-delete metadata.

## Indexing

The model contains:

- unique tenant-scoped slugs;
- unique membership combinations;
- unique user email/normalized email;
- unique invite and API token hashes;
- tenant/status/time composite indexes;
- common lookup indexes for memberships, scopes, reads, dates, and lifecycle fields.

**Needs verification:** index effectiveness and query plans under realistic data volume. No performance benchmark suite was found.

## Seed data

Startup seed can create:

- a default tenant;
- `InternalPilot`, `SchoolPilot`, `Standard`, and `Enterprise` plans;
- optional UI-shell definitions.

It does not create users, memberships, or demo content.

## Search

Search queries relational tables directly with Npgsql `ILike` and membership predicates. There is no separate search index or full-text engine.

PostgreSQL search tests exist but execute only when `POSTGRES_TEST_CONNECTION_STRING` is set.

## Exports, backup, and restore

Tenant export:

- creates an in-memory ZIP;
- includes selected metadata JSON;
- excludes password hashes, token hashes, secrets, and file bodies;
- records an `ExportJob`;
- has no import/restore path.

Operational recovery must back up both PostgreSQL and file storage. Tenant export is not a backup replacement.

## Migration workflow

```bash
dotnet tool restore
dotnet ef migrations add <Name> \
  --project src/AipPortal.Infrastructure \
  --startup-project src/AipPortal.Web
dotnet ef database update \
  --project src/AipPortal.Infrastructure \
  --startup-project src/AipPortal.Web
```

Before merging a migration:

1. Review generated SQL.
2. Verify every tenant-owned table implements `ITenantEntity`.
3. Verify tenant-scoped uniqueness/indexes.
4. Verify data backfills set `TenantId`.
5. Run migration and tenant-isolation tests against PostgreSQL.
6. Document destructive or operationally sensitive changes.

## Unknowns requiring environment evidence

- Largest tested dataset.
- Real migration duration and lock impact.
- Backup schedule and retention.
- Point-in-time recovery configuration.
- Successful database-plus-file restore drill.
- Production PostgreSQL version and extensions.
