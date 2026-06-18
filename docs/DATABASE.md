# Database

Last implementation audit: 2026-06-18.

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

There are thirteen migration classes as of 2026-06-18, from:

- `20260606135558_InitialCreate`
- through `20260610154740_AuthSessionSecurityHardening`

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
- ActivityLog, Comment, Feedback
- Artifact, ArtifactVersion
- FileObject, Attachment, FileScanResult

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
