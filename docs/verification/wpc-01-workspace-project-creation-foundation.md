# WPC-01 Workspace / Project creation backend foundation

Status: partial implementation candidate; blockers remain

Implementation base: `74d0a334e4b3094e1efad48006fce9b13b21bdef`

Specification main: `f7535ce7de1846780a1dd6689e93310f0482897b`

Branch: `wpc/01-workspace-project-creation-foundation`

Date: 2026-08-13

## Verdict

WPC-01 is not a complete canonical backend contract. The branch implements
the independent safe Workspace-create foundation and two narrow Project
compatibility corrections. It intentionally does not invent policy or commit
an unsafe Project Visibility migration. WPC-02/WPC-03 must not bind to a
canonical Project-create or activation API from this candidate.

Blocking outcomes:

- `DECISION REQUIRED — EXISTING PROJECT VISIBILITY BACKFILL`
- `DECISION REQUIRED — PROJECT CREATE AUTHORITY`
- `DEPENDENCY BLOCKER — DELEGATED workspace.create CAPABILITY INFRASTRUCTURE`
- `DEPENDENCY BLOCKER — DEFAULT CHANNEL PROVISIONING`
- `DEPENDENCY BLOCKER — PROJECT TASK WORKFLOW INITIALIZATION`

## Resolved repository state

- Implementation `origin/main` exactly matched the prompt baseline.
- Specification `origin/main` exactly matched the prompt baseline.
- The assigned branch did not exist locally or on `origin`; it was created
  forward from resolved implementation main.
- GitHub reported no open pull requests and no active remote production/schema
  branch with material ownership overlap in the required collision areas.
- Existing unrelated `qodana.yaml`, `.aip-spec-source/**`, `.tools/**`, IDE,
  artifact, local script, and environment files were excluded from every
  change and staging decision.

## Canonical sources used

The following paths were read at specification commit
`f7535ce7de1846780a1dd6689e93310f0482897b`:

- `docs/specs/aip-core-v4/01-core/16-workspace-project-creation-ui-owner-decision-resolution.md`
- `docs/specs/aip-core-v4/01-core/11-workspace-project-governance.md`
- `docs/specs/aip-core-v4/01-core/15-workspace-task-messaging-owner-decision-resolution.md`
- `docs/specs/aip-core-v4/03-acceptance/workspace-project-creation-ui-acceptance.md`
- `docs/specs/aip-core-v4/06-implementation-mapping/workspace-task-messaging-implementation-sequence.md`
- `docs/specs/aip-core-v4/01-core/10-communication-conversation-scope.md`
- `docs/specs/aip-core-v4/01-core/13-messaging-product-contract.md`
- `docs/specs/aip-core-v4/01-core/14-workspace-task-messaging-realtime-addendum.md`
- `docs/specs/aip-core-v4/01-core/22-audit-jobs-consistency.md`
- `docs/specs/aip-core-v4/01-core/api-error-contract.md`
- `docs/specs/aip-core-v4/01-core/outbox-delivery-contract.md`

Current implementation authority also included Tenant/Workspace/Project
authorization services, Project discovery repositories, Search authorization,
Conversation persistence, Task workflow configuration, Outbox publishers,
Audit logging, optimistic-concurrency conventions, global antiforgery setup,
EF migrations, tests, and the root deployment configuration.

## Implementation gap matrix

| Requirement | Canonical source | Existing implementation | Required delta / outcome | Evidence |
| --- | --- | --- | --- | --- |
| Workspace create authority | WPC decisions §§2, 4; governance §8.1 | SystemAdmin-only check | Active current Tenant Owner/Admin implemented; delegation blocked because no capability store/evaluator exists | Workspace authorization and hosted HTTP tests |
| Workspace create capability projection | WPC-DEC-011 | Frontend inferred unrelated state | Added backend `GET /api/workspaces/capabilities` with `canCreate` | Service/controller/HTTP tests |
| Minimal Workspace request | WPC-DEC-004/010 | Name, Description, Icon already present | Preserved; bounded validation and normalization added | Service/controller tests |
| Duplicate Workspace display names | WPC-DEC-009 | Name-derived slug collided under the Tenant unique index | Bounded slug uses the opaque Workspace ID as a deterministic unique suffix | InMemory and PostgreSQL persistence tests |
| Deterministic Workspace defaults | WPC-DEC-005 | Existing server-side nullable Workspace values and resolvers | No browser data added; required default provisioning remains partial | Diff audit |
| Workspace creator Owner atomicity | WPC-DEC-006 | Creator membership saved with Workspace but create audit could fail open | Workspace, one active Owner, required audit, authorization Outbox, and idempotency now share one coordinator transaction | InMemory and PostgreSQL rollback/concurrency tests |
| Workspace default `general` | WPC-DEC-025 | Legacy Channel/Post and canonical Conversation coexist; Conversation lacks a canonical Workspace default-channel provisioning boundary | Blocked; no second communication stack or legacy feature was added | Domain/spec audit |
| Workspace create idempotency | WPC-DEC-021; §13 | None | Durable actor/Tenant/operation/key uniqueness and request reconciliation implemented | PostgreSQL concurrent/rollback tests; hosted HTTP replay test |
| Optional Project Group | WPC-DEC-012 | Domain `Project.GroupId` nullable; create DTO/service require `Guid` and group management | Response now preserves null; canonical create input/path remains blocked by create-authority decision | Project response tests |
| Canonical Project create route | WPC-DEC-020; §12.1 | Only `POST /api/projects`, body owns WorkspaceId | Blocked; no ambiguous partial route added | Route/source audit |
| Project create authority | Governance §9; prompt gate | Group manager required | Exact Workspace-root authority is not specified | Decision required |
| Project Draft creation | WPC-DEC-013/014 | Current service already creates `Planning` and creator Owner | Correct behavior preserved, but only on legacy non-idempotent route | Project service tests |
| Project Visibility | WPC-DEC-016; governance §§3.3, 5, 13 | No domain column; list/detail/search/resource rules disagree | Blocked rather than adding an unsafe column/backfill or UI-only value | Migration and authorization audit |
| Project response normalization | WPC §12 | DTO required GroupId and omitted concurrency version | `GroupId?` and `VersionNo` now projected | Service tests |
| Explicit Project activation | WPC-DEC-024; governance §9.4 | No activation command; generic status paths exist | Blocked on Visibility/channel/workflow semantics | Source audit |
| Generic activation bypass | WPC §12.2 | PATCH allowed direct Planning to Active; indirect suspend/archive paths also exist | Direct transition now returns typed 409; indirect lifecycle paths remain blocking because no persisted activation history distinguishes Draft from formerly Active | Service/controller tests plus lifecycle audit |
| Project default Channel | WPC-DEC-024 | No canonical idempotent Conversation provisioning boundary | Blocked; legacy Channel/Post unchanged | Messaging boundary audit |
| Project Task workflow | WPC-DEC-024 | `AppDbContext` creates a default workflow on initial Project add, before activation | Cannot safely move/attach it without canonical activation semantics | Dependency blocker |
| CSRF | Existing security contract | Global unsafe-method antiforgery | Unchanged | Auth security HTTP regression suite |
| Realtime | WPC decisions; realtime/outbox contract | Transactional Outbox infrastructure exists | Workspace creator authorization-state invalidation staged in same transaction; HTTP remains authoritative | PostgreSQL side-effect assertions |

## API contract before and after

### Workspace create

Before:

- `POST /api/workspaces`
- body `Name`, `Description?`, `Icon?`
- no idempotency identity
- effectively SystemAdmin-only
- generic 200 response/error mapping

After:

```http
POST /api/workspaces
Idempotency-Key: <required, maximum 128 characters>
Content-Type: application/json

{
  "name": "Workspace name",
  "description": null,
  "icon": null
}
```

- route/current authentication supplies actor and Tenant scope;
- HTTP 201 returns the authoritative Workspace DTO;
- replay of the same normalized request returns the same logical resource;
- same scoped key with a different request returns HTTP 409;
- missing/invalid key returns HTTP 400;
- unavailable required idempotency/invalidation infrastructure returns 503;
- capability denial returns 403.

The backend-owned create affordance is:

```http
GET /api/workspaces/capabilities

200 { "canCreate": true }
```

### Project create compatibility state

The canonical route below is **not implemented**:

```http
POST /api/workspaces/{workspaceId}/projects
```

The remaining `POST /api/projects` route is deprecated/incomplete. Its body
still contains `WorkspaceId`, requires `GroupId`, has no Visibility field, and
has no create idempotency identity. Repository search found no active Angular
Project-create caller; current direct callers are backend tests. Removal is
gated on a resolved create-authority decision and one canonical scoped service
path.

Project responses now expose the already-persisted safe fields:

```text
Id, WorkspaceId, GroupId?, OwnerUserId, Title, Description?, Status,
StartDate?, EndDate?, VersionNo, CreatedAt, UpdatedAt?, UiPermissions
```

Visibility is not falsely exposed because it is not yet persisted or
authorized canonically.

### Project activation compatibility state

`POST /api/projects/{projectId}/activate` is **not implemented**. Generic PATCH
returns typed HTTP 409 for the direct `Planning -> Active` transition. It is
not a substitute for activation and does not provision Channel/workflow
defaults.

## Authorization and Visibility behavior

### Workspace

- Active current-Tenant Owner: may create.
- Active current-Tenant Admin: may create.
- Ordinary Member: denied.
- Suspended/inactive Tenant membership: denied.
- Inactive/deleted user: denied.
- Same actor holding authority only in another Tenant: denied in the current
  Tenant.
- Platform/SystemAdmin display/system role alone: no Tenant bypass.
- Delegated `workspace.create`: blocked and therefore denied until a canonical
  delegation store/evaluator exists.

### Project

No partial Visibility implementation was added. Intended behavior remains:

- `WorkspaceVisible`: broad current Workspace discovery only after activation
  and only under resource policy.
- `MembersOnly`: Project participants and explicit governance/audit actors.
- `Restricted`: existence/body/membership/content masked; Workspace Owner/Admin
  alone does not grant body access.
- `Planning`/Draft: no broad discovery solely from intended
  `WorkspaceVisible`.

Current code cannot prove these rules consistently across list, detail,
search, Task, File, membership, or realtime recipient paths. This is a blocker,
not a known-issue waiver.

## Atomicity and idempotency

The new durable identity is scoped by:

```text
TenantId + ActorUserId + Operation + SHA-256(ClientRequestIdentity)
```

The unique PostgreSQL index enforces that scope. `RequestHash` is a SHA-256
fingerprint of normalized Name/Description/Icon, and `ResourceType` plus
`ResourceId` reconcile the response. Raw keys and bodies are not stored.

The coordinator first writes the claim inside an uncommitted relational
transaction. The winner stages the Workspace, creator Owner, audit row, and
authorization Outbox row, saves them, and commits. A concurrent loser waits on
the unique key and then reconciles the committed winner. Any initialization or
save failure rolls back the claim and all staged effects. A failed request
therefore cannot masquerade as a successful replay.

Tenant create authority and current Workspace view authorization are both
rechecked before reconciliation, tenant query filters remain in force, and
operation/actor/Tenant are part of identity. A revoked Workspace member cannot
use an old create identity to recover protected Workspace metadata. A key
cannot return a resource from another actor, Tenant, Workspace operation, or
resource type.
Records have no automatic expiry in this bounded foundation; replay identity
is retained indefinitely. A deleted/unavailable prior resource fails safe with
a replay-unavailable conflict instead of creating a duplicate.

Workspace default `general` and Project Channel/workflow effects are absent,
not falsely counted as atomic. Their absence prevents a complete WPC-01
verdict.

## Migration and backfill decision

Migration:

```text
20260813100711_Wpc01WorkspaceCreateIdempotency
```

It additively creates `idempotency_records`, the actor FK, Tenant/actor/
operation/key unique index, resource lookup index, Tenant index, and creation
time index. It does not alter Workspace, Project, Group, Conversation, Task,
or workflow tables. Down drops only the new table; rolling down loses replay
history but does not remove created business resources.

PostgreSQL tests apply all migrations to an empty database, upgrade a seeded
database from `20260803041347_AddTaskDeadlineDigestLedger`, migrate down, and
reapply. The seeded Project survives. The model reports no pending changes.

Existing Project Visibility mapping: **none committed**. No specification rule
chooses a safe existing-row value. `MembersOnly` may remove current Group/
Workspace-derived access; `WorkspaceVisible` can broaden access; `Restricted`
can remove access and is not implied by current data. No backfill is safe to
infer.

## Default provisioning boundaries

### Workspace general Channel

Canonical messaging uses Conversation persistence, but current Conversation
scope does not model an unambiguous Workspace default Channel with a unique
idempotent provisioning service. The older Channel/Post model is a distinct
legacy representation. WPC-01 adds to neither and does not duplicate
Conversation creation logic.

### Project Task workflow

Current `AppDbContext` initialization adds a default workflow when a new
Project is first saved. Canonical WPC activation requires provisioning or
attaching the required workflow during activation where applicable. Moving or
duplicating this behavior without an approved attachment/compatibility rule
could duplicate stages or change existing Project creation semantics. WPC-01
does not create a second workflow model or modify Task transitions/Kanban.

## Verification commands executed through final-head packaging

The isolated PostgreSQL environment used PostgreSQL 18 on localhost with a
temporary database credential. The credential is intentionally not recorded.
Tests marked PostgreSQL conditional require
`POSTGRES_TEST_CONNECTION_STRING`; an unset environment may report them as
passed after an early return and is not PostgreSQL evidence.

| Command | Exit | Passed | Failed | Skipped | Qualification |
| --- | ---: | ---: | ---: | ---: | --- |
| `dotnet restore AipPortal.slnx` | 0 | n/a | n/a | n/a | Baseline restore |
| `dotnet build AipPortal.slnx --configuration Release --no-restore --disable-build-servers -m:1` | 0 | n/a | n/a | n/a | Baseline, 0 warnings/0 errors |
| `dotnet test tests/AipPortal.Tests/AipPortal.Tests.csproj --configuration Release --no-build --filter "FullyQualifiedName~OrganizationAuthorizationTests\|FullyQualifiedName~ProjectServiceTests\|FullyQualifiedName~ProjectsControllerTests\|FullyQualifiedName~TenancyFoundationTests\|FullyQualifiedName~TenantIsolationSecurityTests"` | 0 | 116 | 0 | 0 | Baseline Workspace/Project/Tenant set |
| `dotnet test tests/AipPortal.Tests/AipPortal.Tests.csproj --configuration Release --no-build --filter "FullyQualifiedName~HttpTenantIsolationTests\|FullyQualifiedName~AuthSecurityHttpTests"` | 0 | 55 | 0 | 0 | Baseline hosted HTTP/CSRF set |
| `dotnet ef database update --project src/AipPortal.Infrastructure --startup-project src/AipPortal.Web --configuration Release --no-build` | 0 | n/a | n/a | n/a | Applied baseline migrations to isolated PostgreSQL after the first representative fixture run identified an unmigrated supplied database |
| `dotnet test tests/AipPortal.Tests/AipPortal.Tests.csproj --configuration Release --no-build --filter "FullyQualifiedName~PostgreSqlMigrationTests\|FullyQualifiedName~PostgreSqlRepositoryTests"` | 0 | 6 | 0 | 0 | Baseline PostgreSQL migration/repository set after migration |
| `dotnet restore AipPortal.slnx` | 0 | n/a | n/a | n/a | WPC candidate; all projects up to date |
| `dotnet build AipPortal.slnx --configuration Release --no-restore --disable-build-servers -m:1` | 0 | n/a | n/a | n/a | WPC candidate, 0 warnings/0 errors |
| `dotnet test tests/AipPortal.Tests/AipPortal.Tests.csproj --configuration Release --no-build --filter "FullyQualifiedName~WorkspaceCreationFoundationTests\|FullyQualifiedName~WorkspacesControllerTests\|FullyQualifiedName~OrganizationAuthorizationTests\|FullyQualifiedName~ProjectServiceTests\|FullyQualifiedName~ProjectsControllerTests\|FullyQualifiedName~TenancyFoundationTests\|FullyQualifiedName~TenantIsolationSecurityTests" --logger "console;verbosity=minimal"` | 0 | 138 | 0 | 0 | Workspace/Project/Tenant service, authorization, controller evidence, including revoked-replay masking |
| `dotnet test tests/AipPortal.Tests/AipPortal.Tests.csproj --configuration Release --no-build --filter "FullyQualifiedName~HttpTenantIsolationTests\|FullyQualifiedName~AuthSecurityHttpTests" --logger "console;verbosity=minimal"` | 0 | 57 | 0 | 0 | Hosted HTTP, cookie, route, and CSRF evidence |
| `dotnet test AipPortal.slnx --configuration Release --no-build --logger "console;verbosity=minimal"` | 0 | 686 | 0 | 163 | Full .NET suite; PostgreSQL-conditional tests were skipped because the connection environment was deliberately unset for this run |
| `dotnet test tests/AipPortal.Tests/AipPortal.Tests.csproj --configuration Release --no-build --filter "FullyQualifiedName~Wpc01WorkspaceCreationPostgreSqlTests\|FullyQualifiedName~PostgreSqlIntegrationTests" --logger "console;verbosity=minimal"` | 1 | 4 | 2 | 0 | Fresh supplied base was intentionally not migrated; all four WPC temporary-database tests passed and the two generic tests reported pending base migrations (environment setup failure) |
| same PostgreSQL command after `dotnet ef database update` | 0 | 6 | 0 | 0 | Real PostgreSQL migration, duplicate-name constraint, concurrency, rollback, repository, and tenant-search evidence |
| `dotnet ef migrations has-pending-model-changes --project src/AipPortal.Infrastructure --startup-project src/AipPortal.Web --configuration Release --no-build` | 0 | n/a | n/a | n/a | Reported no model changes after the WPC migration |
| `dotnet ef database update --project src/AipPortal.Infrastructure --startup-project src/AipPortal.Web --configuration Release --no-build` | 0 | n/a | n/a | n/a | Upgraded isolated current-schema database with `20260813100711_Wpc01WorkspaceCreateIdempotency` |
| `dotnet ef migrations script 20260803041347_AddTaskDeadlineDigestLedger 20260813100711_Wpc01WorkspaceCreateIdempotency --project src/AipPortal.Infrastructure --startup-project src/AipPortal.Web --configuration Release --no-build` | 0 | n/a | n/a | n/a | Additive SQL: create table/FK/indexes/history row only |
| `dotnet ef migrations script 20260813100711_Wpc01WorkspaceCreateIdempotency 20260803041347_AddTaskDeadlineDigestLedger --project src/AipPortal.Infrastructure --startup-project src/AipPortal.Web --configuration Release --no-build` | 0 | n/a | n/a | n/a | Down SQL drops only the new idempotency table/history row |
| `dotnet format AipPortal.slnx --verify-no-changes --no-restore --verbosity minimal` | 1 | n/a | n/a | n/a | Pre-existing repository-wide whitespace violations in unrelated files such as `TaskSubresourceService.cs` and `TenantIsolationSecurityTests.cs`; WPC files pass `git diff --check`; unrelated formatting was not changed |

An earlier baseline representative PostgreSQL run against the supplied but unmigrated
base database reported 4 passed and 2 failed. The failures were missing-schema
environment failures, not code regressions; after `database update`, the same
migration/repository set passed 6/6. No unrelated baseline failure was fixed.
The immutable tested SHA is recorded in the draft PR and execution report
after all scoped commits.

## Unresolved blockers and remediation

### Existing Project Visibility backfill

Required remediation: approve an existing-row mapping or an explicit
classification migration process, then implement one authoritative domain/
persistence/API/authorization policy across discovery and related resources.
This blocks WPC-02 Project binding and WPC-03 creation/activation UX.

### Project create authority

Required remediation: define the Workspace roles/capability that may create a
Workspace-root Project and any separate authority required to select
non-default Visibility. Then implement one Workspace-scoped command with route
scope authoritative. This blocks WPC-03.

### Delegated `workspace.create`

Required remediation: supply the canonical delegation persistence/evaluation
boundary. Do not infer it from role text, `admin:access`, or frontend state.
Tenant Owner/Admin and capability projection are safe for WPC-02, but delegated
users remain unsupported.

### Default Channel provisioning

Required remediation: choose and implement one canonical Conversation-backed,
scope-aware, idempotent provisioning service and define when the capability is
required. It must participate in Workspace create and Project activation
transactions. This blocks complete Workspace creation and Project activation.

### Task workflow initialization and lifecycle provenance

Required remediation: define how existing create-time default workflows map to
activation-time required workflow attachment, and add sufficient lifecycle
state/provenance to distinguish never-activated Drafts from previously Active
Projects during suspend/archive restore. Then close every indirect path to
Active and implement versioned activation. This blocks WPC-03.

## Out-of-scope handoff

- WPC-02: consume the backend `GET /api/workspaces/capabilities` projection;
  implement no create UI until the required `general` provisioning decision is
  accepted. Active Workspace route/preference/single-selection behavior remains
  entirely frontend follow-up.
- WPC-03: do not bind a Project dialog or activation button to the legacy
  `POST /api/projects`. Wait for Visibility/backfill, create authority,
  canonical route, and activation dependencies.
- Workspace member paging/settings/governance redesign remains separate.
- Messaging must supply the canonical default-channel boundary; WPC-01 does not
  extend legacy Channel/Post.
- Task workflow work must reuse canonical definitions/stages and must not alter
  Kanban, Gantt, or transition semantics as a shortcut.

No frontend production file, package/lockfile, Angular configuration, CI file,
legacy hosted SPA artifact, global style, or unrelated Task/Messaging
production file is changed by this candidate.
