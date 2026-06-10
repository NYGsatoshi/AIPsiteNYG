# MVP Scope

Target: usable operation by mid-July 2026 for an initial school activity deployment of about 100 users.

## Included

- Auth: sign in, sign out, current user, password hashing, secure sessions.
- Invite registration: invite creation, invite acceptance, token expiry/revocation basics.
- Users: profile, status, role, admin user management.
- Workspaces: workspace records, members, roles, scoped authorization.
- Groups: group records, members, roles, visibility.
- Channels: channel records, members, posts, threads, scoped visibility.
- Posts and threads: create, list, soft delete, read/unread foundations.
- DM: direct and group conversations, recent messages, send text, read state.
- Unread/read state: conversation unread counts, announcement reads, notification reads.
- Announcements: visible list, detail, read confirmation, create/edit for authorized users.
- Notifications: database-backed list, unread badge/count, mark one/all read.
- File upload basics: metadata, validation, local storage abstraction, download.
- Projects: project records, membership, dashboard/detail basics.
- Tasks: task CRUD basics, status, priority, dates, progress.
- Task assignments: assign users to tasks, list assignments.
- Comments: comments on production entities.
- Activity logs: append activity records for projects/tasks.
- Artifacts: artifact records connected to projects/tasks.
- Basic artifact versions: current version, version history, attachment link.
- Basic Gantt API/view: read-only project timeline with tasks, milestones, dependencies.
- Search basics: scoped search over the first searchable entities.
- Audit logs basics: append-only records and admin/audit query view.
- Admin basics: users, invites, lifecycle actions, settings, dashboard.
- UI shell: authenticated shell, navigation, dashboard, responsive pages.
- Basic radial menu placeholder: disabled/placeholder control and persisted data model.
- Docking foundation: data model and preset layout only.

## Excluded

- Voice calls.
- Video calls.
- Live streaming.
- End-to-end encrypted messaging.
- Post-quantum cryptography.
- Advanced docking.
- Full plugin marketplace.
- Advanced AI.
- Full external Google integration.
- Advanced resource planning.
- Critical path scheduling.

## MVP Rules

- REST APIs remain the source of truth.
- SignalR is deferred until REST workflows are stable.
- Authorization must be enforced in Application services.
- All broad lists must be paginated or bounded.
- File upload must validate size, extension, MIME type, and storage configuration.
- UI must expose empty, error, and permission states without fake backend behavior.
