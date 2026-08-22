# WS-01 Announcement parent-scope hardening

Status: implemented on PR #403; final GitHub Actions / PostgreSQL 18 merge evidence remains pending.

## Reason for correction

The first WS-01 candidate made Announcement audience branches mutually exclusive, but Group- and Channel-scoped reads still accepted a retained `GroupMember` or `ChannelMember` row without re-checking current access to the parent Workspace. That could allow stale child membership to survive a suspended Workspace membership.

The canonical Workspace contract requires membership revocation to invalidate active HTTP authorization, search visibility, cached protected state, and future notification routing. The dashboard count must not introduce or preserve a weaker count-only path.

## Implementation

`AnnouncementReadScope.VisibleAnnouncementsFor` now requires, for non-SystemAdmin access:

- a non-deleted parent Workspace in `Active` or authorized historical `Archived` state;
- an active current `WorkspaceMember` for the actor;
- persisted `Announcement.WorkspaceId`, `GroupId`, and `ChannelId` relationships to agree with the resolved parent objects;
- an active, non-deleted Group for Group/Channel-scoped announcements;
- an active, non-deleted Channel for Channel-scoped announcements;
- the existing audience membership rule after the parent boundary succeeds:
  - Group membership for Group announcements;
  - Group membership for Public/Announcement channels;
  - explicit Channel membership for Private/Confidential channels.

The existing SystemAdmin Announcement-read exception is preserved and remains Tenant-filtered by `AppDbContext`.

`AnnouncementRepository.ListTargetUsersAsync` now applies the same parent-scope consistency and lifecycle rules before resolving targets. Group/Channel audiences are intersected with current active Workspace membership. A stale child membership therefore cannot remain a read-status, resend, notification, or invalidation target after Workspace revocation.

## PostgreSQL regression

Added:

`tests/AipPortal.Tests/PostgreSql/Ws01AnnouncementParentScopePostgreSqlTests.cs`

The regression graph deliberately retains both `GroupMember` and `ChannelMember` after changing the actor's `WorkspaceMember.Status` to `Suspended`.

The test requires all of the following after revocation:

- Announcement list excludes both Group and Private-Channel announcements;
- detail visibility predicate returns false;
- Search returns neither announcement;
- Workspace dashboard returns no card for the revoked ordinary user;
- Group target audience excludes the revoked actor;
- Channel target audience excludes the revoked actor;
- another current authorized Workspace member remains a valid audience target;
- the stale child membership rows still exist, proving parent revocation is the denying boundary.

## Current evidence

Correction commits on `workspace/v1-dashboard-projection`:

- `ea9fb1cc444842ec172b0e6475325ff87389230b` — harden canonical Announcement read scope;
- `c6beee497543f8d07fe810cd011dff3b65484d25` — constrain target audiences to current Workspace access;
- `351bdc806b8c9f27376d860a4c47fde01b748c6d` — add PostgreSQL stale-membership regression.

At head `351bdc806b8c9f27376d860a4c47fde01b748c6d`:

- external `buildkite/aipsitenyg` status: success;
- GitHub Actions checks were queued at the time this evidence note was written;
- the new PostgreSQL regression has not been claimed as passed until an environment with `POSTGRES_TEST_CONNECTION_STRING` actually executes it.

## Remaining merge gate

PR #403 remains stacked on PR #324. Before merge:

1. PR #324 must satisfy its own merge gate and merge first;
2. PR #403 must be retargeted/rebased onto current `main`;
3. final-head standard CI must pass;
4. the WS-01 PostgreSQL suite, including `Ws01AnnouncementParentScopePostgreSqlTests`, must pass against PostgreSQL 18;
5. no migration/model-snapshot change may appear after rebase.
