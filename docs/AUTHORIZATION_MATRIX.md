# Authorization Matrix

This matrix defines the expected authorization rules for current AIP Portal resources. It uses documentation role names from `docs/SECURITY_RULES.md`.

Current implementation notes:

- `PlatformAdmin` maps to `SystemRole.PlatformAdmin`; `SystemRole.SystemAdmin` is an alias used by older code paths.
- `TenantAdmin` maps to active `TenantUserRole.Owner` or `TenantUserRole.Admin`.
- `WorkspaceAdmin` maps to active `WorkspaceRole.Owner` or `WorkspaceRole.Admin`.
- `GroupAdmin` maps to `GroupRole.Owner` or `GroupRole.Admin`.
- `ProjectManager` maps to `ProjectRole.Owner` or `ProjectRole.Manager`.
- `ChatChannel` means the current `Conversation` model for direct/group messages. Group post channels are listed separately as `Channel`.
- `ChatMessage` means the current `Message` model.
- `Notice` means the current `Announcement` model.
- `ActivityEvent / EventItem` means the current `ActivityEvent` model.

Legend:

- `Own` means the authenticated actor is the author, creator, owner, recipient, or the row's user.
- `Scoped member` means the actor can view the stored owning workspace, group, project, channel, or conversation.
- `N/A` means the operation is not currently exposed or not meaningful for that resource.

| Resource | Read | Create | Update | Delete | Manage | Administer |
| --- | --- | --- | --- | --- | --- | --- |
| Tenant | `PlatformAdmin` for all tenants; authenticated active tenant users can read current tenant summary and their own tenant list. | `PlatformAdmin`. | `PlatformAdmin`; `TenantAdmin` can update safe current-tenant settings through tenant administration. | `PlatformAdmin` archives/suspends tenants. | `PlatformAdmin`; `TenantAdmin` manages current-tenant settings and users only. | `PlatformAdmin`. |
| TenantUser | `TenantAdmin` for current tenant; `Own` through current user/tenant membership views; `PlatformAdmin` through platform/admin paths. | `TenantAdmin` in current tenant; `PlatformAdmin` through explicit admin/platform flows. | `TenantAdmin` in current tenant; `PlatformAdmin` for system/admin operations. | `TenantAdmin` removes/suspends current-tenant users; `PlatformAdmin` may archive users through admin APIs. | `TenantAdmin` current tenant; `PlatformAdmin`. | `PlatformAdmin` for system roles and cross-tenant administration. |
| Workspace | Active workspace members; `WorkspaceAdmin`; `PlatformAdmin`. | `PlatformAdmin` under current implementation. | `WorkspaceAdmin`; `PlatformAdmin`. | `WorkspaceAdmin` archives/restores; `PlatformAdmin` lifecycle archive. | `WorkspaceAdmin`; `PlatformAdmin`. | `PlatformAdmin`. |
| WorkspaceMember | Active workspace members can list members; `PlatformAdmin`. | `WorkspaceAdmin`; `PlatformAdmin`. | `WorkspaceAdmin`; `PlatformAdmin`. | `WorkspaceAdmin` suspends/removes; `PlatformAdmin`. | `WorkspaceAdmin`; `PlatformAdmin`. | `PlatformAdmin`. |
| Group | Users who can view the owning workspace; `GroupAdmin`; `WorkspaceAdmin`; `PlatformAdmin`. | `WorkspaceAdmin` or workspace `Adviser`; `PlatformAdmin`. | `GroupAdmin`, `WorkspaceAdmin`, or `PlatformAdmin`. | `GroupAdmin`, `WorkspaceAdmin`, or `PlatformAdmin` archive/restore. | `GroupAdmin`, `WorkspaceAdmin`, or `PlatformAdmin`. | `PlatformAdmin`. |
| GroupMember | Users who can view the group; `GroupAdmin`; `WorkspaceAdmin`; `PlatformAdmin`. | `GroupAdmin`, `WorkspaceAdmin`, or `PlatformAdmin`; target user must belong to the workspace. | `GroupAdmin`, `WorkspaceAdmin`, or `PlatformAdmin`. | `GroupAdmin`, `WorkspaceAdmin`, or `PlatformAdmin`. | `GroupAdmin`, `WorkspaceAdmin`, or `PlatformAdmin`. | `PlatformAdmin`. |
| Channel | Group members for public/announcement channels; channel members for private/confidential channels; `GroupAdmin`; `PlatformAdmin`. | `GroupAdmin`; `PlatformAdmin`. | `ChannelRole.Admin`, `GroupAdmin`, or `PlatformAdmin`. | `ChannelRole.Admin`, `GroupAdmin`, or `PlatformAdmin`; admin lifecycle archive is platform/system admin only. | `ChannelRole.Admin`, `GroupAdmin`, or `PlatformAdmin`. | `PlatformAdmin`. |
| Project | Project members, users who can view the parent workspace/group, and `PlatformAdmin`. | `WorkspaceAdmin` for workspace projects; `GroupAdmin` for group projects; `PlatformAdmin`. | `ProjectManager`, parent `GroupAdmin`, parent `WorkspaceAdmin`, or `PlatformAdmin`. | `ProjectManager`, parent `GroupAdmin`, parent `WorkspaceAdmin`, or `PlatformAdmin` archive/restore. | `ProjectManager`, parent `GroupAdmin`, parent `WorkspaceAdmin`, or `PlatformAdmin`. | `PlatformAdmin`. |
| ProjectMember | Users who can view the project; `ProjectManager`; parent admins; `PlatformAdmin`. | `ProjectManager`, parent `GroupAdmin`, parent `WorkspaceAdmin`, or `PlatformAdmin`; target user must belong to required parent scopes. | `ProjectManager`, parent `GroupAdmin`, parent `WorkspaceAdmin`, or `PlatformAdmin`. | `ProjectManager`, parent `GroupAdmin`, parent `WorkspaceAdmin`, or `PlatformAdmin`. | `ProjectManager`, parent `GroupAdmin`, parent `WorkspaceAdmin`, or `PlatformAdmin`. | `PlatformAdmin`. |
| ActivityEvent / EventItem | Scoped members for published events; draft events only creator or scope managers; `PlatformAdmin` only through authorized visible scope. | Scope managers; existing elevated `Teacher`, `Admin`, or `PlatformAdmin/SystemAdmin` can create in visible scopes. | Creator, scope managers, or elevated visible-scope staff. | Creator, scope managers, or elevated visible-scope staff archive. | Creator, scope managers, or elevated visible-scope staff. | No separate platform event-admin endpoint currently exists; use explicit scope authorization. |
| Attendance | Event managers can list attendance; visible event users can read their own attendance in event detail. | Visible event users can submit their own attendance for published events. | Own attendance before deadline/capacity limits; event managers can update any target user who can access the event scope. | N/A. | Event managers. | No separate platform attendance-admin endpoint currently exists; use event scope authorization. |
| FileObject | Users authorized to the owning `Attachment` scope and current tenant; active files only. | Users authorized to upload to the owner resource, with file feature flag and quota checks. | N/A for file metadata except delete metadata. | Uploader, owner user, or project manager for project-owned attachments; owning-scope checks still apply. | Owning scope managers where implemented; no general file-admin bypass. | No separate platform file-admin endpoint currently exists; platform access must still use explicit owning-scope authorization. |
| ChatChannel | Current model: `Conversation`. Active conversation members. | Authenticated users can create direct or group conversations with valid member users. | Group conversation admin; direct conversations are not title/member managed. | N/A for conversation deletion; members may leave. | Group conversation admin can add/remove members; direct conversations cannot add members. | No separate platform chat-admin endpoint currently exists. |
| ChatMessage | Current model: `Message`. Active conversation members. | Active conversation members. | Message author only. | Message author or group conversation admin. | Group conversation admin can delete messages; direct conversation management is limited. | No separate platform message-admin endpoint currently exists. |
| Notice | Current model: `Announcement`. Visible target users; `PlatformAdmin/SystemAdmin` can read global/current visible announcements under existing service behavior. | Workspace notice: `WorkspaceAdmin` or elevated visible-scope staff. Group notice: `GroupAdmin` or elevated visible-scope staff. Channel notice: channel manager. Global notice: platform/system admin. | Author, platform/system admin, or manager of the owning workspace/group/channel. | Author, platform/system admin, or manager of the owning workspace/group/channel. | Same as update/delete; read-status management requires author/admin/scope manager. | `PlatformAdmin` for global notices and platform/system admin announcement oversight. |
| ActivityLog | Project-visible users when exposed through project workflows; audit-log readers follow audit rules below. | Project-visible/contributing users where ActivityLog APIs exist; current file owner resolution supports ActivityLog attachments. | Project managers when ActivityLog APIs exist. | Project managers when ActivityLog APIs exist. | `ProjectManager`, parent admins, or `PlatformAdmin` when exposed. | `PlatformAdmin` for platform audit views; no broad ActivityLog admin endpoint currently exists. |
| EventItem | Alias of `ActivityEvent`; use the `ActivityEvent / EventItem` row. | Alias of `ActivityEvent`. | Alias of `ActivityEvent`. | Alias of `ActivityEvent`. | Alias of `ActivityEvent`. | Alias of `ActivityEvent`. |
| AuditLog | `TenantAdmin` in current tenant; platform/system admin; existing elevated `Teacher`/`Admin` can read only manageable workspace-scoped audit logs. | Application services only. | N/A; append-only. | N/A; append-only. | `TenantAdmin` and platform/system admin for queries. | `PlatformAdmin`. |
| SecurityEvent | `TenantAdmin` in current tenant; platform/system admin. | Application/security services only. | N/A; append-only. | N/A; append-only. | `TenantAdmin` and platform/system admin for queries. | `PlatformAdmin`. |
| Notification | Recipient user in current tenant. | Application services create notifications for authorized source operations. | Recipient user can mark/read/delete their own notifications. | Recipient user can soft-delete own notifications. | Recipient user for own notifications; system workflows for delivery. | No separate notification-admin endpoint currently exists. |
| Admin endpoints | `PlatformAdmin` for `/api/platform/*` and `/api/admin/*`; `TenantAdmin` for current-tenant `/api/tenant/*` admin endpoints. | Same as endpoint scope. | Same as endpoint scope. | Same as endpoint scope. | Same as endpoint scope. | `PlatformAdmin` for platform/system administration; `TenantAdmin` for current-tenant administration only. |

## Cross-Cutting Requirements

- Every row assumes authentication unless explicitly public.
- Every tenant-owned resource is also constrained by current tenant query filters.
- Every ID-based operation must verify access to the specific stored resource, not only to a parent ID from the request.
- Deleted resources are excluded by default.
- API responses must be DTOs and must not expose EF entities or sensitive fields.
- Admin operations require both route/controller authorization and Application-service authorization.
