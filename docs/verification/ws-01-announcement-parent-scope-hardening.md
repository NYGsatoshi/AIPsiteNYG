# WS-01 Announcement parent-scope hardening

Status: implemented and verified on PostgreSQL 18.6 in draft PR #403.

## Authorization boundary

The canonical shared `VisibleAnnouncementsFor` relation requires non-SystemAdmin
actors to retain active current-Tenant membership and valid parent scope:

- persisted Announcement Workspace/Group/Channel IDs must agree with the
  resolved parent entities;
- Group and Channel parents must be active and non-deleted;
- live Group/Channel access requires current active parent Workspace membership;
- Group announcements and Public/Announcement channels require Group membership;
- Private/Confidential channels require explicit Channel membership.

The existing Tenant-filtered SystemAdmin read exception is preserved. Historical
archived-Workspace reads remain governed by their canonical read relation. Live
target resolution intentionally requires active parents and cannot use an
archived Workspace or stale child row as present delivery authority.

`AnnouncementRepository.ListTargetUsersAsync` applies the same live parent
consistency and lifecycle checks. Target IDs are intersected with active
TenantUser and active Workspace membership before deduplication. A retained
`GroupMember` or `ChannelMember` therefore cannot remain a read-status, resend,
notification, or invalidation target after Workspace revocation.

## PostgreSQL translation repair

At historical PR head `abe99cd20ba6e9f1d086f9d4a4d686d2a2a7274d`,
EF Core 10/Npgsql failed before SQL execution on the target query shaped as:

1. membership relation;
2. User projection to `AnnouncementTargetUser` with correlated
   `AnnouncementReads.Any`;
3. DTO-level `Distinct`;
4. ordering over the constructed DTO.

Moving `Distinct` to scalar authorized User IDs was necessary. PostgreSQL
translation additionally required ordering active Users by `DisplayName` and
`Id` before constructing the DTO. The correlated authorized read-state check
remains server-side. There is no client-side authorization/filtering boundary.

Historical PostgreSQL 18.6 reproduction: 0 passed, 1 failed, 0 skipped.
Post-repair result: 1 passed, 0 failed, 0 skipped.

## Revocation regression

`Ws01AnnouncementParentScopePostgreSqlTests` deliberately retains the actor's
physical GroupMember and ChannelMember rows after suspending the parent
WorkspaceMember. It proves:

- list excludes the Group and Private-Channel announcements;
- detail visibility returns false;
- Search returns neither announcement;
- dashboard reachability is removed;
- target resolution excludes the revoked actor;
- another currently authorized member remains a valid target;
- the stale child rows remain stored, proving parent revocation is the denying
  boundary.

The combined WS-01 PostgreSQL 18.6 selection passes 3/3, including both
Workspace dashboard methods and this parent-scope regression. The complete
backend suite passes 1097/1097 with zero skips, and EF reports no model drift.

## Identity and merge state

- Starting repair head: `abe99cd20ba6e9f1d086f9d4a4d686d2a2a7274d`.
- Tested implementation correction:
  `b68773a710cf2b4e0614a4eb193396ebfe9059bd`.
- Latest `main` integrated while preparing this note:
  `42dcc9f12fa4b2f7f1dee8eaa7f962690ccc5efa`.
- PR #324 is merged; PR #403 now targets `main` and remains Draft.

This backend regression is closed. The PR-level merge gate remains open only
for the exact-head repository frontend/acceptance blockers documented in
`ws-01-workspace-dashboard-backend-projection.md` and in the live PR body.
