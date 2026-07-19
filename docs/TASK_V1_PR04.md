# Task v1 PR04 — My Tasks projection

`GET /api/me/tasks` is the canonical, server-paged My Tasks projection. It accepts relationship views (`assigned`, `participating`, `reviews`, `created`, `watching`, `teamQueue`, and `completed`), an explicit workspace scope, project/stage/priority/blocked/search filters, and the five urgency groups.

## Scope and authorization

`currentWorkspace` is the default. A caller must send an active, authorized `workspaceId` when they have more than one available Workspace; the server only selects a Workspace without a client ID when it is the caller's sole active Workspace. This deliberately avoids inferring a Workspace from an arbitrary Project. `allWorkspaces` is explicit and includes only active Workspace memberships in the current Tenant.

The projection starts with active Workspace membership and the existing Project visibility rule, then applies the requested relationship predicate. It never starts from the legacy assignment table, so multiple relations do not create duplicate rows. A membership revocation is evaluated by every request and removes the row/count on the next HTTP or realtime-triggered refresh.

## Query plan and indexes

The projection is one paged `task_items` query plus one batched label lookup for the current page. It does not issue a relationship query per row. The PR04 migration adds indexes for the tenant/workspace Task sort path and primary-assignee, reviewer, creator, collaborator, and effective-watch predicates.

Current urgency comparison uses the persisted UTC deadline and date-only planned end. Workspace-local timezone materialization is retained as a follow-up because the current Workspace entity does not yet own a timezone field; no timezone is inferred from a Project or browser locale.

## Frontend rollout

The `/tasks` route keeps its current URL. `tasks.myTasksV1` gates the canonical grouped list in the browser; it is not authorization. Kanban is intentionally unavailable until PR05. SignalR events coalesce into an HTTP refresh and an authorization-state event clears cached protected rows before refetching.
