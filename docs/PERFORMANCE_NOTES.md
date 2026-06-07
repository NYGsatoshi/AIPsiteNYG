# Performance Notes

## Current Assumptions

- The MVP target is an initial controlled pilot of about 100 users.
- PostgreSQL is the primary database provider.
- Tenant isolation is enforced through `ITenantEntity` global query filters and application authorization checks.
- The current pass favors pagination, projection, `AsNoTracking`, and supporting indexes over distributed caching.

## Endpoints Reviewed

- Users and invites use paged admin APIs with page-size clamping.
- Tenant/platform administration APIs are platform-scoped where appropriate and use tenant-aware repositories.
- Workspaces, groups, channels, projects, tasks, comments, events, forms, notifications, announcements, audit logs, security events, search, messages, and posts were reviewed for unbounded list risk.
- Channel posts already used page/pageSize and before/after cursors; thread replies now use the same bounded pattern.
- Conversation lists now use page/pageSize before loading last-message and unread-count details.
- `GET /api/me/tasks` now returns a paged response and pushes filters/sorting into SQL.
- Gantt, dashboard, workload, and my-task queries use projections and avoid full entity graph loading.

## Indexes Added

- `workspaces`: `(TenantId, CreatedAt)`, `(TenantId, Status)`
- `groups`: `(TenantId, WorkspaceId)`, `(TenantId, Status)`
- `channels`: `(TenantId, GroupId)`, `(TenantId, Status)`
- `posts`: `(TenantId, ChannelId, CreatedAt)`
- `post_threads`: `(TenantId, PostId, CreatedAt)`
- `conversations`: `(TenantId, WorkspaceId)`, `(TenantId, UpdatedAt)`
- `conversation_members`: `(TenantId, UserId)`
- `messages`: `(TenantId, ConversationId, CreatedAt)`
- `notifications`: `(TenantId, UserId, IsRead, CreatedAt)`
- `projects`: `(TenantId, GroupId, Status)`, `(TenantId, Status)`, `(TenantId, CreatedAt)`
- `task_items`: `(TenantId, ProjectId, Status)`, `(TenantId, DueDate)`
- `task_assignments`: `(TenantId, UserId)`, `(TenantId, TaskItemId)`
- `artifacts`: `(TenantId, ProjectId)`, `(TenantId, Status)`
- `comments`: `(TenantId, TargetType, TargetId, CreatedAt)`
- `audit_logs`: `(TenantId, CreatedAt)`, `(TenantId, Action)`, `(TenantId, ActorUserId)`
- `security_events`: `(TenantId, CreatedAt)`, `(TenantId, EventType)`

## Known Bottlenecks

- Search is simple PostgreSQL-backed `ILIKE` over indexed scope columns and capped per source. Full-text search remains future work.
- Conversation listing still performs bounded per-conversation last-message/unread lookups; acceptable for the pilot page size, but a projection query or materialized conversation summary would scale better.
- Storage usage and file count are calculated through current metadata/usage paths. Large tenants should move to background usage snapshots before broad production.
- Project detail sublists such as members, milestones, and assignments remain unpaged because they are expected to be small in the pilot. Revisit if real projects exceed classroom/team scale.

## Future Improvements

- Redis for tenant-scoped short-lived settings, feature flags, and module metadata after invalidation rules are implemented.
- PostgreSQL full-text search or a dedicated search index for larger deployments.
- Background usage aggregation for storage, file count, API request count, and active user metrics.
- Object storage CDN for downloads after the object storage adapter exists.
- SignalR scale-out for multi-instance realtime notifications and messages.
