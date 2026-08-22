# WS-01 Workspace dashboard backend projection

## Change identity

- Implementation repository `origin/main` at preflight:
  `74cca8756bac69061c676d924fcb74a6edf3123b`.
- Specification repository `origin/main` at preflight:
  `38339ba2964587f225c4c4151f643abb5523e862`.
- PR #324 (`wpc-final03-security-no-go`) was open at preflight at
  `807dc832e081d96c390a4623d602e848e3de81ec`. Before push its head advanced
  only by a fixture-repair CI workflow commit; this branch was rebased onto the
  refreshed exact head, `bae823e8be2bb200d58c02d593ce88d579af85e7`, and the
  draft PR targets that branch while #324 remains open.
- Implementation branch: `workspace/v1-dashboard-projection`.
- No decision conflict was found between the current specifications and the
  two approved WS-01 product decisions.

## API contract

`GET /api/workspaces` remains the raw array of active Workspaces visible to the
current user in the resolved Tenant. The change is additive; no dashboard route,
envelope, or paging contract was introduced. Each item is now a
`WorkspaceDashboardListItemResponse` with these JSON fields:

- `id`, `name`, `description`, `icon`, `status`, `createdAt`, `updatedAt`;
- `currentUserRole`, `accessSource`;
- `canOpenWorkspace`, `canOpenMembers`, `canOpenProjects`;
- `unreadAnnouncementCount`, `unreadConversationCount`,
  `inProgressProjectCount`.

`updatedAt` uses `Workspace.UpdatedAt ?? Workspace.CreatedAt`. It does not claim
to be cross-resource activity. Existing basic list consumers can ignore the new
fields and continue deserializing the original fields. The separate
`GET /api/workspaces/capabilities` endpoint remains the backend authority for
page-level `canCreate`; Workspace creation was not redesigned.

All three numeric metrics are guaranteed by the PostgreSQL projection. A
provider that cannot compose the canonical authorization relations makes the
whole list fail with typed `DependencyUnavailable`; it never returns null or
fabricated zero counts. A successfully evaluated empty aggregate is numeric
zero.

## Authorization semantics

### Workspace role and access source

- An active `WorkspaceMember` row returns its exact canonical role: `Owner`,
  `Admin`, `Adviser`, `Member`, or `ReadOnly`.
- Membership-backed access returns `accessSource = WorkspaceMembership`.
- An active SystemAdmin who can view an active Workspace through the existing
  platform exception, but has no active Workspace membership, receives
  `currentUserRole = null` and `accessSource = SystemAdmin`.
- If a SystemAdmin also has an active membership, the real membership role wins.
- Suspended membership is not projected as a current role. An ordinary user
  loses the card; a SystemAdmin may retain the card only through the existing
  SystemAdmin read exception.
- Archived and soft-deleted Workspaces remain outside this endpoint.

### Card navigation capabilities

The card relation is produced only after the canonical active-Workspace read
boundary succeeds. `canOpenWorkspace` and `canOpenMembers` therefore reflect the
same current read relation used by Workspace detail and member-list endpoints.
The Project surface is valid for the same authorized active Workspace, while
each returned Project remains independently filtered through
`VisibleProjectsFor`. These booleans grant no mutation or child-resource read
authority. In particular, a `ReadOnly` membership can open the members surface
while `CanManageWorkspace` still denies member mutation.

### Announcement count

`unreadAnnouncementCount` is the number of currently published, unexpired,
non-deleted Announcements in the Workspace that are visible to the actor and do
not have that actor's `AnnouncementRead` row. List, detail/read-state gating,
Search, and the dashboard compose the same SQL-translatable
`VisibleAnnouncementsFor` relation. Its branches are mutually exclusive:

- Tenant-global announcements require all three scope IDs to be absent;
- Workspace-only announcements require active Workspace membership;
- Group announcements require Group membership;
- public/announcement Channel announcements require Group membership;
- private/confidential Channel announcements require explicit Channel
  membership;
- the existing SystemAdmin Announcement-list exception is preserved.

The dashboard query selects only grouped IDs and counts. It does not select
Announcement title, body, author, or email.

### Conversation count

`unreadConversationCount` counts authorized Conversations with at least one
non-deleted Message from another user after the current user's canonical
`ReadState.LastReadAt` (or any such Message when no read state exists). Multiple
unread Messages in one Conversation still contribute one. The query composes
`IMessagingRepository.QueryReadableConversationIds`, the same PostgreSQL
recursive participant/read scope used by the canonical Conversation list and
Message Search. Removed/left/non-readable participants, unauthorized Project
Conversations, non-participant DMs, and inconsistent Thread ancestry cannot
contribute. No Conversation title, participant list, or Message body is selected.

### In-progress Project count

`inProgressProjectCount` is exactly `ProjectStatus.Active +
ProjectStatus.Review`, after composing the existing SQL-translatable
`VisibleProjectsFor(userId)` relation. Planning, Completed, Suspended, Archived,
Deleted, soft-deleted, and unauthorized Projects do not contribute.
MembersOnly and Restricted behavior therefore follows the current Project
membership/visibility boundary; the dashboard introduces no Workspace-level
shortcut and no Restricted-Project existence side channel.

## Query architecture and bounded-count evidence

`WorkspaceDashboardQuery` executes sequentially on the scoped `AppDbContext`:

1. one active Workspace plus exact active membership-role/SystemAdmin-source
   projection;
2. one grouped authorized unread Announcement count;
3. one grouped authorized unread Conversation count;
4. one grouped authorized visible Active/Review Project count.

An empty Workspace relation stops after query 1. For a non-empty result, an EF
command interceptor observed exactly four reader commands for five Workspace
cards and exactly four for one Workspace card. Therefore command count is
bounded independently of card count. SQL inspection in the same test confirmed
that none of the four commands selected a `Body` or `Title` column.

All reads are `AsNoTracking` where applicable, aggregates execute in
PostgreSQL, and no parallel operation is issued against the scoped context.

## PostgreSQL security evidence

The WS-01 PostgreSQL graph uses only synthetic `example.test` identities and
contains two Tenants, five canonical Workspace roles, a SystemAdmin with and
without Workspace membership, revoked memberships, all relevant Project
lifecycles/visibilities, Announcement audiences/read state, and
Workspace/Project/DM Conversation combinations.

The assertions prove:

- Tenant B Workspace rows never appear in the Tenant A response;
- Tenant B Announcement, Conversation, and Project rows carrying a stale
  Tenant A Workspace ID do not change Tenant A counts;
- the SystemAdmin exception remains Tenant-filtered;
- a hidden Group/private-Channel Announcement does not affect list, detail,
  Search, or dashboard count;
- a non-participant DM, removed participant, and Restricted-Project
  Conversation do not affect the Conversation count;
- an unread Conversation with two unread Messages counts once;
- Restricted Project non-membership does not affect the Project count;
- MembersOnly Project membership adds the count and removal immediately removes
  it;
- Workspace membership suspension removes the ordinary user's card;
- a SystemAdmin-only card has an explicit null role rather than fabricated
  `Admin`.

## Verification

Local PostgreSQL evidence used a disposable `postgres:16-alpine` container and
temporary per-test databases. The shared test database was migrated only to run
one existing search-isolation test that expects a pre-migrated database.

Commands and results confirmed after rebasing onto the refreshed PR #324 head:

```powershell
dotnet restore AipPortal.slnx --configfile .git/ws01-nuget.config /p:RestoreFallbackFolders=
```

Passed for all five projects. The temporary config only clears a missing local
Syncfusion NuGet fallback-folder entry and uses nuget.org; it is under `.git`
and is not part of the change.

```powershell
dotnet build AipPortal.slnx -c Release --no-restore --nologo
```

Passed with 0 errors and 6 pre-existing warnings in unrelated WPC test files
(one `CS8602` and five `xUnit2031`).

```powershell
dotnet test tests/AipPortal.Tests/AipPortal.Tests.csproj -c Release --no-build --filter "Category!=PostgreSQLIntegration"
```

Passed: 855; failed: 0; skipped: 0. Two initial failures identified the EF
InMemory HTTP harness's obsolete expectation that `/api/workspaces` could
produce the canonical PostgreSQL projection. The harness now asserts the typed
503 fail-closed response and absence of Workspace names. The real PostgreSQL
tests below remain the projection and Tenant-isolation authority.

```powershell
dotnet test AipPortal.slnx -c Release --no-build --logger "console;verbosity=quiet"
```

Passed: 855; failed: 0; skipped: 233; total: 1088. The 233 skips are the
repository's conditional PostgreSQL tests when the connection-string variable
is absent; they are not treated as PostgreSQL evidence. The security-relevant
PostgreSQL selection was run separately with a real database as recorded below.

```powershell
$env:POSTGRES_TEST_CONNECTION_STRING = "<disposable local PostgreSQL>"
dotnet test tests/AipPortal.Tests/AipPortal.Tests.csproj -c Release --no-build --filter "FullyQualifiedName~WorkspaceDashboardProjection|FullyQualifiedName~WorkspacesControllerTests"
```

Passed: 15; failed: 0; skipped: 0. This selection is rerun after every final
source/test correction.

```powershell
$env:POSTGRES_TEST_CONNECTION_STRING = "<disposable local PostgreSQL>"
$filter = "FullyQualifiedName~Ws01WorkspaceDashboardProjectionPostgreSqlTests|FullyQualifiedName~WpcFinal03SecurityPostgreSqlTests|FullyQualifiedName~ActiveGroupedProjectReadBoundaryIsEquivalentAcrossDetailListSearchMessagingAndMyTasks|FullyQualifiedName~RecursiveConversationReadScopeRejectsCyclesAndInconsistentProjectScope|FullyQualifiedName~MessageSearchAuthorizesAllMatchingConversationsBeforeDeterministicLimit|FullyQualifiedName~PlanningProjectDiscoveryRequiresExplicitProjectMembership|FullyQualifiedName~MembersOnlyProjectMemberRemovalRevokesConversationAndTaskNotificationAccess|FullyQualifiedName~RestrictedProjectBlocksTaskNotificationAndRealtimeForWorkspaceOnlyMember|FullyQualifiedName~ArchivedWorkspaceReadScopeRequiresCurrentMembershipEvenForSystemAdmin|FullyQualifiedName~TenantScopedSearchIsolationWorksAgainstPostgreSql"
dotnet test tests/AipPortal.Tests/AipPortal.Tests.csproj -c Release --no-build --filter $filter --logger "console;verbosity=normal"
```

Passed: 12; failed: 0; skipped: 0. It includes both WS-01 PostgreSQL tests, both
PR #324 security tests, active grouped Project read-boundary parity, recursive
Conversation scope, Message Search authorization-before-limit, Planning
discovery, MembersOnly revocation, Restricted Project notification/realtime,
archived Workspace SystemAdmin scope, and existing Tenant-scoped Search.

The existing Tenant-scoped Search test separately passed 1/1 after the
disposable shared test database was migrated. This resolved its environment
precondition; it required no source change.

Scoped `dotnet format` whitespace and analyzer verification covered every
changed C# file and both commands exited 0. The repository-wide whitespace
verifier also reports unrelated pre-existing format drift; no unrelated
formatting was applied.

## Scope confirmation

- No migration, model snapshot, Domain entity, or schema change.
- No frontend production, AppShell, route, hosted `wwwroot`, package, lockfile,
  or CI workflow change.
- No Workspace creation, Project creation/activation, Messaging write,
  realtime, file, Task, Kanban, or Gantt behavior change.
- PR #324's exact-Tenant membership admission and fail-closed Workspace-general
  synchronization are neither duplicated nor changed.

## Remaining work

- Frontend WS-01 wiring must consume the additive fields and remove its role,
  count, and card-capability placeholders.
- WS-02 active Workspace selection and route preference remain separate.
- WS-03 member paging/filtering/management UI remains separate.
- WS-04 Workspace settings remain separate.
- WS-05 Channel governance remains separate.
