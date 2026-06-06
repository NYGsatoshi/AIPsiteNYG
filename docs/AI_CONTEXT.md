# AI Context

## Product

AIP Portal is a school activity operations platform for extracurricular activities, committees, inquiry learning, and production/project management.

It is not only a chat app. Messaging is one part of a wider system that connects workspaces, groups, channels, direct messages, announcements, tasks, attendance/event handling later, files, project tracking, artifacts, feedback, notifications, search, and audit logs.

## Initial Scope

The first production target is about 100 users. Prefer clear, maintainable ASP.NET Core code over distributed-system complexity.

Primary stack:

- ASP.NET Core / C#
- PostgreSQL
- EF Core
- Modular monolith
- REST API first
- SignalR later for realtime messaging
- Docker-ready later, but Docker is not mandatory at first

## Explicitly Deferred

- Voice calls
- Video calls
- Live streaming
- End-to-end encrypted direct messages
- Post-quantum cryptography
- Advanced external integrations
- Advanced AI features
- Fully dynamic plugin marketplace
- Fully free-form docking UI

## Architecture Direction

Use a modular monolith, not microservices. Modules should have clear namespaces, application services, DTOs, validators, and persistence mappings, but they initially deploy as one ASP.NET Core application.

Recommended solution structure:

```text
src/
  AipPortal.Web/
  AipPortal.Application/
  AipPortal.Domain/
  AipPortal.Infrastructure/
tests/
  AipPortal.Tests/
```

Layer responsibilities:

- `Web`: HTTP endpoints, pages/components, request/response DTO binding, auth middleware setup.
- `Application`: use cases, authorization checks, transactions, notifications, audit logging.
- `Domain`: entities, enums, value objects, domain rules.
- `Infrastructure`: EF Core, PostgreSQL persistence, file storage, background jobs, search, external services.

## Module List

- Auth
- Users
- Workspaces
- Groups
- Channels
- Messaging
- Announcements
- Notifications
- Files
- Projects
- ProductionTracking
- Feedback
- Search
- Audit
- UiShell
- Admin

## Implementation Priorities

1. Auth and authorization
2. Workspace, group, and member management
3. Channels, posts, and threads
4. Direct messages and unread management
5. Announcements and read confirmation
6. Files and attachments
7. Project management
8. Production tracking
9. Tasks, assignments, comments, artifacts, uploads
10. Basic Gantt chart data API
11. Notifications
12. Search
13. Audit logs
14. UI docking foundation
15. Maya-like radial menu foundation

## Security Principles

- Hash passwords. Never store plaintext passwords.
- Enforce authorization server-side for all modifying operations.
- Prevent cross-workspace and cross-group data leaks.
- Use secure cookies if cookie authentication is chosen.
- Use soft delete where appropriate.
- Record audit logs for important operations.
- Validate file size and extension.
- Store file paths and limits in settings, not hardcoded paths.

## AI Assistance Rules

When generating code for this project:

- Do not put business logic directly in controllers.
- Do not return EF entities directly from APIs.
- Use DTOs for requests and responses.
- Put authorization checks in Application use cases.
- Make important operations audit-log-ready.
- Use pagination for list APIs.
- Avoid N+1 queries.
- Prefer simple EF Core queries and explicit includes/projections.
- Keep the first Gantt API read-only and simple.
- Add indexes for foreign keys and common filters.
- Keep abstractions small and tied to current requirements.
