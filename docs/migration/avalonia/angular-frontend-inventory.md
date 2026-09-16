# Angular frontend inventory for Avalonia migration

Issue: #765  
Parent plan: #798  
Source branch: `main`  
Source commit: `4e6a10903a5a472ca89f833aba993a29e1b2cf73`  
Inventory date: 2026-09-13

This document is a point-in-time inventory of the production Angular frontend under `frontend/`. It is intentionally descriptive: it records the current routed surfaces, state ownership, external integrations, Angular-specific dependencies, and test evidence needed by the Avalonia migration issues. The machine-readable companion is `angular-frontend-inventory.json`.

## Executive findings

- Production routing is centralized in `frontend/src/app/app.routes.ts`. Public auth/system routes sit outside `AppShellComponent`; application routes are guarded by `authSessionGuard`, with selected workspace routes additionally guarded by `workspaceContextGuard`.
- `package.json` declares `@ngrx/store`, `@ngrx/effects`, `@ngrx/entity`, and `@ngrx/component-store`, but repository code search at the pinned commit found no production `@ngrx/*` imports. No NgRx reducer/effect/store implementation was found. Current application state is predominantly Angular Signals plus RxJS, owned by facades/services.
- SignalR browser use is deliberately isolated in `SignalrRealtimeTransport`, connected to `/hubs/app` with same-origin credentials and the CSRF header. `RealtimeFacade` fans durable events and authorization invalidation into feature facades.
- REST calls use relative `/api/*` URLs and browser cookie credentials. Unsafe calls participate in the existing CSRF/auth interceptor contract. Avalonia must preserve the server contract while replacing browser-only cookie/CSRF plumbing with an explicit desktop HTTP/session implementation.
- File flows are not simple CRUD. They include multipart upload, server-authorized download grants, preview/download Blob handling, sharing/folder state, search, task attachment selection, progress/cancellation, and realtime invalidation.
- Existing tests are substantial but Angular/browser-specific at the UI layer. The migration must preserve contract tests and real-backend evidence while replacing DOM/Playwright/Storybook-specific assertions with Avalonia equivalents.
- #798 is the roadmap authority for timing. Its November technical-preview core is `Launch -> Login -> Workspace -> Project -> Task`. Conversation/Channel/DM are Wave 6 (post-November daily work), and Audit/Admin are Wave 7. There is no standalone graph route in `app.routes.ts`; graph ownership remains unresolved, but it is not a November-required route under the current #798 roadmap unless that roadmap is amended.

## Production route and screen inventory

`Protected` means the route is under the `AppShellComponent` + `authSessionGuard` branch. `Workspace guard` means `workspaceContextGuard` is also applied.

| Route | Screen / behavior | Access | State / integration owner | Migration note |
| --- | --- | --- | --- | --- |
| `/signin` | Redirect to `/login` | Public | Router | Preserve compatibility redirect. |
| `/login` | `LoginPageComponent` | Public | `AuthSessionFacade` / REST | November core. |
| `/session-expired` | `SessionExpiredPageComponent` | Public | `AuthSessionFacade` | Preserve explicit expired-session state. |
| `/register/invite` | `InviteRegistrationPageComponent` | Public | `InviteRegistrationFacade`, `AuthSessionFacade` / REST | Invite bootstrap path. |
| `/permission-denied` | `AppPermissionDeniedComponent` | Public/system | component/input state | November shell fail-closed state. |
| `/` | Redirect to `/workspaces` | Protected | `AuthSessionFacade`, `AppShellFacade` | Desktop startup target should be equivalent. |
| `/messages/saved` | `MessageFollowUpsPageComponent` | Protected | `MessageFollowUpFacade`, `MessagingApi`, realtime | Post-November Wave 6. |
| `/messages/settings` | `MessageSettingsPageComponent` | Protected | `MessagingFacade` / REST | Post-November Wave 6. |
| `/messages` | `MessagesPageComponent` | Protected | `MessagingFacade`, `MessagingApi`, realtime | Post-November Wave 6 Conversation scope; not November Required under current #798. |
| `/conversations/:conversationId` | `ChannelMessagingPageComponent` | Protected | `MessagingFacade`, `MessagingApi`, realtime | Post-November Wave 6. |
| `/workspaces/:workspaceId/channels/:conversationId` | `ChannelMessagingPageComponent` | Protected + workspace guard | `MessagingFacade`, `WorkspaceSelectionFacade`, realtime | Post-November Wave 6. |
| `/dm/:conversationId` | `DmPageComponent` | Protected | `MessagingFacade`, realtime | Post-November Wave 6. |
| `/workspaces/:workspaceId/research/new` | `WorkspaceResearchQuickCreatePageComponent` | Protected + workspace guard | component/local state, `WorkspacesFacade`, quick-create service / REST | Workspace context is mandatory; Maintenance Only on Angular. |
| `/workspaces/:workspaceId/projects` | `ProjectsOverviewPageComponent` | Protected + workspace guard | `ProjectsFacade`, `ActiveWorkspaceFacade` / REST / realtime | November core Project surface. |
| `/workspaces/:workspaceId/files` | `FilesPageComponent` | Protected + workspace guard | `FilesFacade`, `FileFolderStore`, `ActiveWorkspaceFacade` / REST / realtime / file I/O | Post-November file surface. |
| `/workspaces/:workspaceId/members` | `WorkspaceMembersPageComponent` | Protected + workspace guard | `WorkspaceMembersFacade` / REST / realtime | Membership/authorization surface. |
| `/workspaces` | `WorkspaceDashboardPageComponent` | Protected | `WorkspacesFacade`, active/selected workspace state | November core Workspace surface. |
| `/announcements` | `AnnouncementsPageComponent` | Protected | `AnnouncementsFacade` / REST | List/default detail behavior. |
| `/announcements/:announcementId` | `AnnouncementsPageComponent` | Protected | `AnnouncementsFacade` / REST | Deep-link detail. |
| `/app/projects/:projectId/tasks/:taskId/reports/:artifactVersionId` | `ReportReaderPageComponent` | Protected | component/local state / report REST | Compatibility alias. |
| `/app/projects/:projectId/reports/:artifactVersionId` | `ReportReaderPageComponent` | Protected | component/local state / report REST | Compatibility alias. |
| `/projects/:projectId/tasks/:taskId/reports/:artifactVersionId` | `ReportReaderPageComponent` | Protected | component/local state / report REST | Task-scoped report deep link. |
| `/projects/:projectId/reports/:artifactVersionId` | `ReportReaderPageComponent` | Protected | component/local state / report REST | Project-scoped report deep link. |
| `/projects/:projectId/tasks/new` | `TaskCreatePageComponent` | Protected | `TaskCreateFacade`, `TaskCreateApi`, realtime | November core Task creation. |
| `/projects/:projectId/tasks/:taskId` | `TaskDetailPageComponent` | Protected | task/detail local services, `FilesFacade`, realtime | November core Task detail; high-complexity migration surface. |
| `/projects/:projectId` | `ProjectDetailPageComponent` | Protected | `ProjectDetailFacade` / REST / realtime | November core Project detail. |
| `/tasks` | `MyTasksPageComponent` | Protected | `MyTasksFacade` / REST / realtime | Wave 6 daily-work scope. |
| `/projects` | `ProjectsOverviewPageComponent` | Protected | `ProjectsFacade` / REST / realtime | November core Project entry. |
| `/artifacts/:artifactId` | `ArtifactDetailPageComponent` | Protected | component/local state / artifact REST | Artifact deep link. |
| `/files` | `FilesPageComponent` | Protected | `FilesFacade`, `FileFolderStore`, `ActiveWorkspaceFacade` / REST / realtime / file I/O | Wave 6 daily-work scope. |
| `/account` | `AccountPageComponent` | Protected | `AccountFacade`, notification preference facade / REST | Wave 7 management scope. |
| `/admin/audit/findings` | `AuditFindingsPageComponent` | Protected | `AuditFindingsFacade` / REST | Post-November Wave 7. |
| `/admin/audit/claims-evidence` | `AuditClaimsEvidencePageComponent` | Protected | `AuditClaimsEvidenceFacade` / REST | Post-November Wave 7. |
| `/admin/audit/package-export` | `AuditPackageExportPageComponent` | Protected | component/local state / audit export REST / file download | Post-November Wave 7. |
| `/admin/audit` | `AuditLogPageComponent` | Protected | `AdminFacade` / REST / realtime | Post-November Wave 7. |
| `/admin/invites` | `InviteAdminPageComponent` | Protected | `AdminFacade` / REST | Post-November Wave 7. |
| `/admin/export-diagnostics` | `ExportDiagnosticsPageComponent` | Protected | `AdminFacade` / REST | Post-November Wave 7; implementation injects `AdminFacade`. |
| `**` | `PagePlaceholderComponent` | Fallback | Router | Current not-implemented fallback; do not silently turn this into a desktop success path. |

## State ownership

### NgRx status

The frontend declares NgRx 22 packages, but no production `@ngrx/*` import was found at the pinned commit. Accordingly there are no reducer/effect/store graphs to port from the current implementation. Treat the packages as dependency inventory until a later commit introduces actual usage; do not infer that Signals/RxJS state is stateless.

### Signal/RxJS facade and service state

| Owner | Kind | Primary consumers / routes | Migration significance |
| --- | --- | --- | --- |
| `AuthSessionFacade` | Angular Signals | login, guards, shell, most authenticated features | Session/identity root; must be migrated before protected screens. |
| `ActiveWorkspaceFacade` | Signals | shell and workspace/project/file/task features | Cross-feature workspace scope. |
| `WorkspaceSelectionFacade` | Signals + service state + realtime | shell/workspace navigation | Selection and authorization invalidation coupling. |
| `WorkspacesFacade` | Signals + REST/realtime | `/workspaces`, workspace research quick-create capability lookup | Dashboard/workspace state. |
| `AppShellFacade` | derived Signals | all protected routes | Global navigation/view model. |
| `TenantSwitchFacade` / `TenantScopedStateFacade` | Signals + REST/realtime | cross-cutting | Tenant boundary reset must remain fail-closed. |
| `RealtimeFacade` | RxJS/owned subscriptions | cross-cutting | Central durable-event and authorization-invalidation fan-out. |
| `MessagingFacade` | Signals/RxJS | `/messages`, conversation/channel/DM routes | Chat state, pagination, optimistic/current-route concerns. |
| `MessageFollowUpFacade` | Signal state + realtime | `/messages/saved` | Saved-message projection. |
| `ProjectsFacade` | Signals + REST/realtime | project overviews | Project collection state. |
| `ProjectDetailFacade` | Signals + REST/realtime | `/projects/:projectId` | Project board/detail state. |
| `ProjectCreateFacade` | Signals + API/router | project-create UI embedded outside a dedicated route | Preserve even though it is not represented as its own route. |
| `TaskCreateFacade` | Signals + API/router/realtime | `/projects/:projectId/tasks/new` | Authorization-sensitive creation state. |
| `MyTasksFacade` | Signals + REST/realtime | `/tasks` | Server paging/filter state. |
| `FilesFacade` | Signals + RxJS subscriptions + REST/realtime | `/files`, workspace files, task file picker | Multiple independent state epochs; cancellation and stale-result protection matter. |
| `FileFolderStore` | Signals + REST | file page/move dialog | Despite the name, this is not NgRx Store. |
| `AnnouncementsFacade` | Signals + REST | announcements routes | Announcement list/detail state. |
| `AccountFacade` | Signals + REST | `/account` | Account state. |
| `TaskNotificationPreferencesFacade` | Signals + REST | account/task settings | Preference state. |
| `AdminFacade` | Signals + REST/realtime | `/admin/audit`, `/admin/invites`, `/admin/export-diagnostics` | Admin/audit/diagnostics state. |
| `AuditFindingsFacade` | Signals + REST | `/admin/audit/findings` | Triage state. |
| `AuditClaimsEvidenceFacade` | Signals + REST | `/admin/audit/claims-evidence` | Claims/evidence state. |
| `RightPanelFacade` | Signals + REST/realtime/router | shell/right panel | Cross-screen contextual panel. |
| `ContinueWorkingFacade` | Signals + REST/file grants | shell/shared surface | Cross-screen recent-work projection. |

Local component Signals/fields also own route-local ephemeral state in `AppPermissionDeniedComponent`, `WorkspaceResearchQuickCreatePageComponent`, `ReportReaderPageComponent`, `ArtifactDetailPageComponent`, and `AuditPackageExportPageComponent`. These should become Avalonia view-model properties rather than a global store unless a later issue establishes a cross-screen ownership requirement.

## External integration inventory

### REST/authentication

- Browser calls use relative `/api/*` paths, same-origin credentials, and existing auth/CSRF interceptors.
- Major frontend REST owners include auth/session, tenant switching, workspace membership/dashboard, projects/project detail/task creation/My Tasks, messaging/search/follow-ups/preferences, announcements, files/folders/preview/search/sharing, account/preferences, audit/admin/export, report/artifact readers, and workspace research quick-create.
- Messaging is explicitly centralized in `MessagingApi`; representative endpoint families include `/api/conversations*`, `/api/messages*`, `/api/me/message-follow-ups*`, `/api/me/message-notification-preferences`, and `/api/search*`.
- Preserve server DTO/authorization semantics. The Avalonia client should not copy browser-specific interceptor assumptions verbatim.

### SignalR

`SignalrRealtimeTransport` is the sole browser SignalR transport and connects to `/hubs/app`. It:

- sends credentials plus the CSRF header during negotiate;
- uses automatic reconnect delays of 0s, 1s, 3s, and 7s;
- receives `DurableEvent` and `AuthorizationInvalidated` callbacks;
- exposes transport status events;
- supports user, tenant, workspace, conversation, and project subscriptions;
- intentionally requires transport stop rather than client-side user/tenant unsubscribe.

The Avalonia implementation must preserve subscription authorization and stale-connection isolation, not merely reconnect to the hub.

### File and binary I/O

Current browser file behavior includes:

- multipart upload through `POST /api/files` with owner metadata and progress reporting;
- file inventory and picker pagination through `GET /api/files`;
- search through `/api/search`;
- server-issued download grants such as `POST /api/files/{fileObjectId}/download-grants` and attachment download-grant equivalents;
- preview/download flows that currently depend on browser `File`, `FormData`, Blob/object-URL/download behavior;
- folder/move, sharing, delete, version/activity, selection snapshot, and task attachment integration;
- cancellation/stale-response protection and realtime inventory refresh.

These are desktop-native I/O migration concerns even when the REST contract itself remains unchanged.

## Angular/browser-specific dependency inventory

| Dependency | Current purpose | Avalonia migration concern |
| --- | --- | --- |
| Angular 22 core/common/router/forms/platform | component model, DI, routing, forms, browser runtime | Replace with Avalonia controls, DI/bootstrap, navigation and view-model composition. |
| Angular CDK | UI primitives/behavior | Audit each consumer; no direct runtime portability. |
| RxJS 7 | async composition and subscriptions | Can be retained conceptually or replaced with .NET async/observable patterns; cancellation semantics must survive. |
| `@microsoft/signalr` | browser SignalR client | Replace with the .NET SignalR client while preserving hub contract and auth behavior. |
| NgRx 22 packages | declared dependency; no production imports found | Do not plan a mechanical NgRx port from this snapshot; remove/retain only after dependency cleanup issue confirms usage. |
| Syncfusion Angular Gantt/Grids/Inputs/Popups | high-density data UI, Gantt and widgets | Angular wrappers cannot move; feature parity/performance/interaction contracts need Avalonia implementations or approved replacements. |
| AG Grid Angular/community | grid UI | Angular wrapper and DOM renderer cannot move; inventory grid behaviors before replacement. |
| `@lucide/angular` | icons | Replace Angular wrapper; preserve semantic icon use/accessibility. |
| Zone.js | Angular browser change-detection/runtime support | Not needed in Avalonia. |
| Storybook Angular | component catalog/visual development | Replace with Avalonia component-gallery/visual-regression workflow. |
| Vitest + jsdom | unit/component tests | Browser DOM assumptions do not transfer; business/view-model tests should become .NET tests, UI tests Avalonia-specific. |
| Playwright + axe-core (root test project) | browser E2E, snapshots, accessibility | Keep backend contract scenarios where possible; replace DOM/browser-only assertions for desktop UI and define Avalonia accessibility/automation evidence. |

## Test evidence and gaps

### Existing evidence to preserve

- `frontend` runs Angular/Vitest tests through `ng test --watch=false` and has architecture/license/bundle scripts.
- Root UI tests use Playwright, including `angular-smoke.spec.ts`, `real-backend-smoke.spec.ts`, public HTTPS golden-path coverage, messaging actions/follow-ups/search/thread/mobile navigation, file sharing/version history, workspace attention, task execution source policy, and audit accessibility/claims/findings coverage.
- There are real-backend and functional harnesses in addition to mocked browser routes. Those are valuable contract evidence and should not be discarded merely because the Angular renderer is replaced.
- File facade/component tests explicitly cover multipart upload and download-grant behavior.

### Migration gaps / weak points

1. **No Avalonia test harness exists yet.** Current component and E2E evidence assumes Angular/DOM/Playwright.
2. **Route equivalence is not machine-enforced.** The companion JSON provides a baseline, but a later migration gate should assert that every required Angular route/surface is either mapped to an Avalonia screen, explicitly retired, or retained as a compatibility deep link.
3. **No standalone graph route is visible.** Graph ownership still needs to be identified for its later migration issue. Under the current #798 roadmap it is not part of the November `Login -> Workspace -> Project -> Task` core preview unless #798 is amended.
4. **Several deep-link/admin/report surfaces do not have an obviously named dedicated Playwright spec in the `tests/ui` top-level inventory.** Existing large smoke suites may cover them, but later screen issues should cite exact test cases rather than infer coverage from suite size.
5. **Browser file behavior is highly coupled to browser primitives.** REST tests alone are insufficient; Avalonia needs native upload/download/preview/cancel/error-path tests.
6. **Realtime authorization and stale-epoch behavior require dedicated desktop coverage.** A successful SignalR connection is not equivalent to preserving protected-state clearing, authorization invalidation, and scoped subscription semantics.
7. **Declared-but-unused NgRx dependencies are migration noise.** A dependency cleanup/check should prevent later migration planning from inventing nonexistent reducer/effect work.

## How later migration issues should use this inventory

- Use `angular-frontend-inventory.json` as the baseline for route/surface accounting and `angular-feature-freeze-matrix.json` as the authoritative per-route timing/freeze classification derived from #798.
- Record the source Angular route(s), state owners, REST/realtime/file dependencies, and existing test evidence in each Avalonia screen issue.
- Migrate cross-cutting foundations first: auth/session -> tenant/workspace context -> HTTP/CSRF/session adapter -> realtime -> shell/navigation. Feature screens should not duplicate these concerns.
- Treat file handling and realtime as behavioral contracts, not UI-only work.
- Before closing the final Angular-removal issue, diff the then-current `app.routes.ts` and dependency graph against this pinned snapshot and account for changes introduced after `4e6a1090`.
