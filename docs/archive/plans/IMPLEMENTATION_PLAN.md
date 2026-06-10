# Implementation Plan

## Phase 0: Documentation And Skeleton

Goal: establish the project shape before production features.

Tasks:

- Create solution and project structure.
- Add ASP.NET Core Web, Application, Domain, Infrastructure, and test projects.
- Add shared conventions for IDs, timestamps, soft delete, pagination, and API errors.
- Configure appsettings for PostgreSQL and file storage without hardcoded local paths.
- Add CI-ready build and test commands once the solution exists.

Acceptance:

- Solution builds.
- Test project runs.
- Layer references enforce the intended direction.
- Documentation matches the created structure.

## Phase 1: Auth, Users, And Workspaces

Goal: create the secure base for all scoped data.

Tasks:

- Implement users, sessions, password hashing, and login/logout.
- Add invitation flow for initial onboarding.
- Implement workspaces and workspace members.
- Add workspace roles and server-side resource authorization.
- Add audit logging for auth and membership operations.

Acceptance:

- Users can sign in securely.
- Workspace membership controls access.
- Cross-workspace reads and writes are rejected.
- Important changes create audit log records.

## Phase 2: Groups, Channels, And Messaging

Goal: support communication inside school activity structures.

Tasks:

- Implement groups and group members.
- Implement channels and channel members.
- Implement posts and post threads.
- Implement direct conversations, messages, and read states.
- Add unread count APIs.
- Add pagination to all list endpoints.

Acceptance:

- Workspace members can access only allowed groups and channels.
- Posts, threads, DMs, and unread states work through REST APIs.
- No API returns EF entities directly.

## Phase 3: Announcements, Files, And Notifications

Goal: support official communication and shared assets.

Tasks:

- Implement announcements with read confirmation.
- Implement file metadata, upload validation, attachment links, and scan status.
- Implement database-backed notifications.
- Add notification creation to messages, announcements, comments, and assignments.
- Add basic search across posts, files, announcements, projects, and tasks.

Acceptance:

- Announcements can require read confirmation.
- Files validate size and extension before storage.
- Notifications can be listed and marked read.
- Search returns scoped, authorized results.

## Phase 4: Projects And Production Tracking

Goal: support project and production management workflows.

Tasks:

- Implement projects and project members.
- Implement milestones.
- Implement tasks with status, priority, dates, progress, and soft delete.
- Implement task assignments using `TaskAssignment`.
- Implement task dependencies, initially FinishToStart only.
- Implement comments on projects, tasks, artifacts, and activity logs.
- Implement activity logs.
- Implement artifact upload and artifact versions.
- Implement feedback.
- Implement basic Gantt data API.

Acceptance:

- Project members can manage project tasks according to role.
- Tasks support multiple assignees through join records.
- Dependencies are persisted and returned by the Gantt API.
- Artifact versions are traceable.
- Comments and feedback are audit-log-ready.

## Phase 5: UI Shell Foundation

Goal: prepare the user interface model for docking panels and radial commands.

Tasks:

- Implement feature module registry.
- Implement panel definition registry.
- Implement user layout persistence.
- Implement command definition registry.
- Implement radial menu profile and item persistence.
- Expose REST APIs for reading shell configuration.

Acceptance:

- UI can load available modules, panels, commands, layouts, and radial menu profiles.
- User layout can be saved and restored.
- Data model supports future docking and radial menu improvements.

## First 5 Implementation Steps

1. Create the solution/projects and enforce references: Web -> Application -> Domain, Infrastructure -> Application/Domain, Web -> Infrastructure for composition.
2. Add shared domain primitives: `BaseEntity`, `IAuditableEntity`, `ISoftDelete`, UTC timestamp handling, pagination contracts, and API error shape.
3. Configure EF Core with PostgreSQL, initial DbContext, Fluent API conventions, and migration setup.
4. Implement Auth, Users, Sessions, Invites, Workspaces, WorkspaceMembers, password hashing, and resource authorization.
5. Add AuditLog infrastructure and make auth/workspace operations write audit records inside transactions.

## Risk Areas

- Authorization leakage across workspaces, groups, channels, projects, or conversations.
- Returning too much data from broad list/search endpoints.
- Letting controllers accumulate business logic.
- File uploads without strict validation and storage configuration.
- Naming collision with C# `System.Threading.Tasks.Task`; use a domain class name such as `ProjectTask` while mapping to a `Tasks` table.
- Gantt API scope creep; keep the first API read-only and compact.

## Assumptions

- Initial deployment is a single ASP.NET Core app with PostgreSQL.
- About 100 users is the first scale target.
- Realtime features are optional until the REST workflows are stable.
- Local file storage is acceptable initially if abstracted and configured.
- The first UI can be conventional; docking and radial menus start as data foundations.
