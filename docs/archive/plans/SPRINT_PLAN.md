# Sprint Plan

Scope: six weeks from June 8, 2026 through July 17, 2026. Owners are Developer A for Backend / DB / Security, Developer B for Frontend / UI / UX, and Developer C for Production tracking / tests / integration.

## Week 1: Foundation Lock

- Goals: stabilize auth, workspace membership, API error shape, seed data, and build/test commands.
- Deliverables: verified auth flow, invite basics, workspace/member APIs, shared pagination/error conventions.
- Owner: Developer A primary, Developer C for test harness, Developer B for shell smoke checks.
- Dependencies: current solution structure and EF Core persistence.
- Done criteria: solution builds, tests run, sign-in works, cross-workspace reads are blocked.
- Risks: authorization gaps and migration churn.

## Week 2: Groups, Channels, Posts

- Goals: complete workspace communication foundations before DM polish.
- Deliverables: groups, group members, channels, channel members, posts, threads, read state groundwork.
- Owner: Developer A for APIs, Developer B for list/detail UI, Developer C for integration tests.
- Dependencies: Week 1 auth and membership.
- Done criteria: scoped members can post only where authorized; list APIs are bounded.
- Risks: group/channel access leaks and frontend route sprawl.

## Week 3: DM, Notifications, Announcements

- Goals: make communication workflows usable for MVP.
- Deliverables: DM list/detail/composer/read state, notifications page/badge, announcements list/detail/read confirmation/create/edit.
- Owner: Developer B primary, Developer A for API fixes, Developer C for UI and API smoke tests.
- Dependencies: groups/channels and notification persistence.
- Done criteria: unread counts update, deleted message bodies are hidden, announcement read status is authorized.
- Risks: unread logic complexity and confusing permission states.

## Week 4: Projects And Tasks

- Goals: make production tracking usable.
- Deliverables: projects, project members, tasks, assignments, comments, activity logs.
- Owner: Developer C primary, Developer A for backend authorization, Developer B for project/task UI.
- Dependencies: auth, users, workspaces, files where comments/artifacts link to uploads.
- Done criteria: project members can manage tasks by role; comments and activity logs are visible in project context.
- Risks: task ownership rules and incomplete integration between tracking entities.

## Week 5: Files, Artifacts, Gantt, Search

- Goals: complete asset and planning basics.
- Deliverables: file upload validation/storage, artifacts, artifact versions, read-only Gantt view/API, scoped search.
- Owner: Developer C for artifacts/Gantt, Developer A for files/search backend, Developer B for upload/search/Gantt UI.
- Dependencies: projects/tasks and file storage settings.
- Done criteria: uploads reject invalid files, artifact versions are traceable, Gantt returns scoped task data.
- Risks: file upload security and Gantt UI complexity.

## Week 6: Admin, Audit, Hardening

- Goals: prepare for mid-July MVP operation.
- Deliverables: admin dashboard, audit query basics, deployment checklist, Docker-ready configuration, regression pass.
- Owner: Developer A for security/admin, Developer C for tests/deployment, Developer B for UI polish.
- Dependencies: all MVP modules.
- Done criteria: production checklist passes, major flows are smoke-tested, known exclusions are documented.
- Risks: deployment delay, hidden authorization regressions, and unresolved scope creep.
