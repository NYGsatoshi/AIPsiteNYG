# GitHub Issues

## Epic 1: Foundation

### 1. Lock shared API response and pagination contracts
- Type: refactor
- Priority: P0
- Owner suggestion: Backend
- Description: Ensure list endpoints use bounded pagination and consistent error payloads.
- Acceptance criteria: APIs return DTOs only; broad lists have page/pageSize or explicit limits; errors use the shared shape.
- Dependencies: none

### 2. Add MVP smoke test command
- Type: test
- Priority: P0
- Owner suggestion: Tracking
- Description: Document and verify the build/test command used during MVP development.
- Acceptance criteria: `dotnet build` and `dotnet test` pass locally; docs mention the commands.
- Dependencies: none

### 3. Seed minimal development data
- Type: infra
- Priority: P1
- Owner suggestion: Backend
- Description: Provide safe local seed data for admin, workspace, groups, project, and communication testing.
- Acceptance criteria: development seed is explicit, idempotent, and does not run accidentally in production.
- Dependencies: auth and persistence

## Epic 2: Auth and membership

### 4. Verify invite registration flow
- Type: feature
- Priority: P0
- Owner suggestion: Backend
- Description: Complete invite acceptance, token validation, expiration, and accepted state.
- Acceptance criteria: valid invites create users; expired/revoked invites fail; audit records are created.
- Dependencies: users, invites

### 5. Harden workspace authorization tests
- Type: test
- Priority: P0
- Owner suggestion: Tracking
- Description: Cover cross-workspace read/write denial for workspace-owned records.
- Acceptance criteria: tests prove non-members cannot view or mutate another workspace.
- Dependencies: workspace APIs

### 6. Build membership management UI
- Type: feature
- Priority: P1
- Owner suggestion: Frontend
- Description: Add workspace and group member list/add/update/remove screens.
- Acceptance criteria: authorized users can manage members; unauthorized users see clear errors.
- Dependencies: workspace/group APIs

## Epic 3: Communication

### 7. Complete DM frontend MVP
- Type: feature
- Priority: P0
- Owner suggestion: Frontend
- Description: Provide conversation list, detail, recent messages, text composer, create flow, and read-on-open behavior.
- Acceptance criteria: no unlimited history loads; empty send is rejected; deleted message content is not shown.
- Dependencies: conversation APIs

### 8. Add DM unread integration tests
- Type: test
- Priority: P0
- Owner suggestion: Tracking
- Description: Verify unread counts and mark-read behavior.
- Acceptance criteria: opening a conversation updates read state; unread count decreases for the reader only.
- Dependencies: conversation read API

### 9. Add scoped user picker API
- Type: feature
- Priority: P1
- Owner suggestion: Backend
- Description: Add a non-admin user/member search endpoint for starting conversations and assigning work.
- Acceptance criteria: results are scoped to visible workspace/group/project membership; admin user list is no longer needed for normal DM creation.
- Dependencies: workspace/group membership

### 10. Build channel post/thread UI
- Type: feature
- Priority: P1
- Owner suggestion: Frontend
- Description: Add channel list/detail, post composer, and thread view using existing APIs.
- Acceptance criteria: users can post only where authorized; empty/error states are shown.
- Dependencies: channel APIs

## Epic 4: Production tracking

### 11. Complete project dashboard UI
- Type: feature
- Priority: P0
- Owner suggestion: Frontend
- Description: Show project summary, tasks, members, comments, artifacts, and Gantt tab.
- Acceptance criteria: project detail is usable without direct API testing tools.
- Dependencies: project/task/artifact APIs

### 12. Implement task assignment workflow
- Type: feature
- Priority: P0
- Owner suggestion: Tracking
- Description: Support assigning users to tasks and listing assignees.
- Acceptance criteria: authorized users can add/remove assignees; duplicate assignments are rejected.
- Dependencies: scoped user picker

### 13. Add activity log creation points
- Type: feature
- Priority: P1
- Owner suggestion: Backend
- Description: Create activity records for key project/task changes.
- Acceptance criteria: task create/update/status changes emit activity entries.
- Dependencies: project/task services

### 14. Add comments integration coverage
- Type: test
- Priority: P1
- Owner suggestion: Tracking
- Description: Verify comments on projects, tasks, artifacts, and activity logs.
- Acceptance criteria: comments are scoped, paginated, and soft-delete-safe.
- Dependencies: comments API

## Epic 5: Files and artifacts

### 15. Harden file upload validation
- Type: feature
- Priority: P0
- Owner suggestion: Backend
- Description: Enforce file size, extension, MIME type, and configured storage path.
- Acceptance criteria: invalid files are rejected before storage; paths come from configuration.
- Dependencies: file storage abstraction

### 16. Build artifact version UI
- Type: feature
- Priority: P1
- Owner suggestion: Frontend
- Description: Show artifact detail, current version, version history, and upload action.
- Acceptance criteria: versions are traceable; upload failures are visible.
- Dependencies: artifact and file APIs

### 17. Add file security tests
- Type: test
- Priority: P0
- Owner suggestion: Tracking
- Description: Test invalid extensions, oversize uploads, and unauthorized downloads.
- Acceptance criteria: test failures catch unsafe upload/download behavior.
- Dependencies: file API

## Epic 6: Notifications and announcements

### 18. Complete notifications frontend
- Type: feature
- Priority: P0
- Owner suggestion: Frontend
- Description: Add notification page/badge/list/mark-one/mark-all with related links.
- Acceptance criteria: badge updates after read actions; targetRoute links navigate when provided.
- Dependencies: notification APIs

### 19. Complete announcements frontend
- Type: feature
- Priority: P0
- Owner suggestion: Frontend
- Description: Add list/detail/read confirmation/create/edit/read-status/resend unread where authorized.
- Acceptance criteria: create form is hidden for clearly unauthorized users; backend permission errors are shown.
- Dependencies: announcement APIs

### 20. Add announcement read tests
- Type: test
- Priority: P0
- Owner suggestion: Tracking
- Description: Verify read confirmation and read-status authorization.
- Acceptance criteria: required read button appears only when needed; read status is blocked for unauthorized users.
- Dependencies: announcement service

## Epic 7: UI shell

### 21. Stabilize responsive shell navigation
- Type: feature
- Priority: P1
- Owner suggestion: Frontend
- Description: Ensure navigation, header, notification access, and mobile sidebar work across MVP pages.
- Acceptance criteria: no overlapping header/sidebar content at mobile and desktop widths.
- Dependencies: current static frontend

### 22. Persist preset layout foundation
- Type: feature
- Priority: P2
- Owner suggestion: Shared
- Description: Expose and store preset UI layouts without advanced docking.
- Acceptance criteria: users can load default layout data; no free-form docking is introduced.
- Dependencies: UiShell APIs

### 23. Keep radial menu as MVP placeholder
- Type: docs
- Priority: P2
- Owner suggestion: Frontend
- Description: Document placeholder behavior and avoid building full radial interactions.
- Acceptance criteria: UI has a disabled/placeholder affordance and data model remains ready.
- Dependencies: UiShell docs

## Epic 8: Search and audit

### 24. Implement scoped search basics
- Type: feature
- Priority: P1
- Owner suggestion: Backend
- Description: Search visible posts, announcements, files, projects, and tasks.
- Acceptance criteria: results are scoped to the current user and return compact DTOs.
- Dependencies: module repositories

### 25. Build search results UI
- Type: feature
- Priority: P1
- Owner suggestion: Frontend
- Description: Replace search placeholder with grouped search results.
- Acceptance criteria: empty, loading, and error states are handled.
- Dependencies: search API

### 26. Add audit log query UI
- Type: feature
- Priority: P1
- Owner suggestion: Frontend
- Description: Show audit records for authorized admins.
- Acceptance criteria: filters by actor/action/target/date exist; unauthorized users cannot view logs.
- Dependencies: audit query API

## Epic 9: Admin and operations

### 27. Finish admin dashboard UI
- Type: feature
- Priority: P0
- Owner suggestion: Frontend
- Description: Add dashboard metrics, users, invites, settings, and lifecycle operation screens.
- Acceptance criteria: SystemAdmin can perform MVP admin workflows from the UI.
- Dependencies: admin APIs

### 28. Add admin action audit coverage
- Type: test
- Priority: P0
- Owner suggestion: Tracking
- Description: Verify admin user, invite, settings, and lifecycle actions create audit records.
- Acceptance criteria: tests assert action, actor, target, and summary metadata.
- Dependencies: admin services

### 29. Document production operations checklist
- Type: docs
- Priority: P1
- Owner suggestion: Shared
- Description: Keep the deployment and production checklist current for MVP launch.
- Acceptance criteria: checklist covers secrets, DB, storage, backups, logs, and rollback.
- Dependencies: deployment decisions

## Epic 10: Deployment and hardening

### 30. Make app Docker-ready
- Type: infra
- Priority: P1
- Owner suggestion: Backend
- Description: Verify Dockerfile, docker-compose, environment variables, storage path, and health behavior.
- Acceptance criteria: app can run with PostgreSQL through compose in a clean environment.
- Dependencies: configuration cleanup

### 31. Run authorization regression pass
- Type: test
- Priority: P0
- Owner suggestion: Tracking
- Description: Review all MVP endpoints for server-side resource authorization.
- Acceptance criteria: high-risk endpoints have tests for unauthorized and cross-scope access.
- Dependencies: MVP endpoint set

### 32. Perform MVP UI smoke pass
- Type: test
- Priority: P0
- Owner suggestion: Shared
- Description: Exercise auth, admin, communication, project/task, files, search, and audit flows.
- Acceptance criteria: blocking defects are filed; non-blocking issues are triaged.
- Dependencies: MVP UI pages
