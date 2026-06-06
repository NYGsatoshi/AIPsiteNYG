# Architecture

## Style

AIP Portal uses a modular monolith. The application is deployed as one ASP.NET Core app, but code is organized around business modules with clear boundaries. This keeps the first version simple while leaving room to split modules later if the product grows.

## Solution Structure

```text
src/
  AipPortal.Web/
  AipPortal.Application/
  AipPortal.Domain/
  AipPortal.Infrastructure/
tests/
  AipPortal.Tests/
```

## Layer Responsibilities

### Web

- ASP.NET Core startup, middleware, auth configuration, routing.
- REST controllers or minimal API endpoints.
- Request and response DTOs.
- Model validation responses.
- No business rules beyond request shaping.

### Application

- Use cases and command/query handlers.
- Server-side authorization checks.
- Transaction boundaries.
- Notification dispatch requests.
- Audit log creation.
- Pagination, filtering, and sorting policies.
- DTO projection contracts.

### Domain

- Entities, enums, value objects, and domain rules.
- Invariants that do not require infrastructure.
- No EF-specific query logic.
- No HTTP concerns.

### Infrastructure

- EF Core DbContext, configurations, migrations.
- PostgreSQL persistence.
- File storage implementation.
- Search indexing/query implementation.
- Background jobs.
- Email or other external service adapters later.

## Module Boundaries

Modules are namespaces and folders inside the layers, not separate services at first.

Suggested module folders:

```text
AipPortal.Application/
  Auth/
  Users/
  Workspaces/
  Groups/
  Channels/
  Messaging/
  Announcements/
  Notifications/
  Files/
  Projects/
  ProductionTracking/
  Feedback/
  Search/
  Audit/
  UiShell/
  Admin/
```

The Domain and Infrastructure projects should mirror these modules where useful.

## Request Flow

1. Web endpoint receives a request DTO.
2. Web maps identity claims to a user context.
3. Web calls an Application use case.
4. Application loads required data using repositories or DbContext-backed services.
5. Application performs server-side authorization.
6. Application changes domain state inside a transaction.
7. Application records audit log entries for important operations.
8. Application queues or creates notifications when needed.
9. Web returns a response DTO.

## Persistence

Use PostgreSQL with EF Core.

Persistence rules:

- Use one application DbContext initially.
- Configure entities using Fluent API.
- Use UTC timestamps.
- Prefer `Guid` identifiers unless a future requirement justifies numeric IDs.
- Add indexes for foreign keys, slugs, timestamps, read states, search fields, and common filters.
- Use soft delete for user-facing content where recovery or audit visibility matters.
- Do not expose EF entities directly from APIs.

## Authentication And Authorization

Initial options:

- Cookie auth for server-rendered UI and same-site API calls.
- JWT bearer later if separate clients need it.

Authorization must be enforced in Application use cases, not only by controller attributes. Controller attributes can reject obviously invalid access, but they are not enough to prevent workspace, group, project, or channel data leaks.

Use policy names for broad capabilities, then resource checks for specific records:

- Workspace member required
- Workspace admin required
- Group member required
- Channel member required
- Project member required
- Owner/admin override where appropriate

## Files

Files are stored through an abstraction, not direct local path usage.

Initial implementation can use local disk storage configured through settings:

- Base storage path
- Max file size
- Allowed extensions
- Allowed MIME types
- Scan status behavior

Store metadata in PostgreSQL. Store file bytes outside the database unless a later requirement changes this.

## Notifications

Start with database-backed notifications. Each notification should have recipient, type, source object, created timestamp, read timestamp, and compact display data.

SignalR can be added later to push new notifications and messages in realtime. The REST API should remain the source of truth.

## Search

Start with PostgreSQL-backed search using indexed fields and simple text search. Keep the search module behind an Application/Infrastructure abstraction so a dedicated search engine can be introduced later.

## Audit

Audit logs should be append-only from normal application code.

Capture:

- Actor user ID
- Action
- Target type and ID
- Workspace or project scope when applicable
- Timestamp
- Summary metadata
- Request correlation ID when available

Avoid storing sensitive secrets or raw file contents in audit metadata.

## UI Shell Foundation

The UI shell starts with persisted data structures, not a fully dynamic desktop system.

Foundational concepts:

- `FeatureModule`: registered app feature.
- `PanelDefinition`: dockable or navigable panel type.
- `UserLayout`: user-specific persisted panel arrangement.
- `CommandDefinition`: command palette and action registry item.
- `RadialMenuProfile`: named radial menu configuration.
- `RadialMenuItem`: menu item linked to command, panel, or route.

Docking and radial menu data should be stable enough that a richer UI can be added later without changing core tables.

## Docker Readiness

Docker is not mandatory for the first commit, but the app should avoid assumptions that block containers:

- No hardcoded absolute storage paths.
- Configuration through environment variables and settings files.
- PostgreSQL connection string from configuration.
- Static files and uploads separated.
- Health endpoint later for container checks.
