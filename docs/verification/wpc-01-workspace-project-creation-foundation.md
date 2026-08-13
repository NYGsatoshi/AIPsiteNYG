# WPC-01 Workspace / Project creation backend foundation

Status: fail-closed remediation candidate for independent merge audit

- PR: #281
- Base SHA: `74d0a334e4b3094e1efad48006fce9b13b21bdef`
- Starting HEAD: `270b539163a49616cd5971af2eb3b58321c50a87`
- Specification SHA: `f7535ce7de1846780a1dd6689e93310f0482897b`
- Branch: `wpc/01-workspace-project-creation-foundation`
- Date: 2026-08-13

## Verdict

WPC-01 does not report an incomplete canonical create operation as successful.
Production Workspace creation is gated because the repository has no canonical,
Conversation-backed provisioner for the required Workspace `general` channel.
Canonical Project creation and activation are also unavailable while exact
authority, Visibility migration, default Channel, and Task workflow decisions
remain unresolved.

The implemented foundation is safe and deliberately bounded:

- every application status change into `ProjectStatus.Active` is rejected;
- archive/restore of an ambiguous Project returns it to `Planning`;
- Planning and provenance-ambiguous lifecycle states fail closed against broad
  discovery and subordinate-resource access;
- legacy body-scoped Project creation returns 503 without mutation;
- Workspace initialization availability is server-owned, and production cannot
  return 201 while required `general` provisioning is unavailable;
- successful no-op initializer tests exercise the transaction/idempotency seam
  only and are not evidence that `general` was provisioned.

## Canonical sources reconciled

The following files were read at specification SHA
`f7535ce7de1846780a1dd6689e93310f0482897b` before production changes:

- `01-core/16-workspace-project-creation-ui-owner-decision-resolution.md`
- `01-core/11-workspace-project-governance.md`
- `01-core/15-workspace-task-messaging-owner-decision-resolution.md`
- `03-acceptance/workspace-project-creation-ui-acceptance.md`
- `06-implementation-mapping/workspace-task-messaging-implementation-sequence.md`
- `01-core/10-communication-conversation-scope.md`
- `01-core/13-messaging-product-contract.md`
- `01-core/14-workspace-task-messaging-realtime-addendum.md`
- `01-core/api-error-contract.md`
- `01-core/outbox-delivery-contract.md`
- `01-core/22-audit-jobs-consistency.md`

## Requirement matrix

| Requirement | Normative source | Classification | Actual state |
| --- | --- | --- | --- |
| Tenant Owner/Admin Workspace-create authority | WPC-DEC-002; governance §8.1 | IMPLEMENTED | Current active Tenant membership is authoritative. Platform/SystemAdmin status alone is not a bypass. |
| Delegated `workspace.create` | WPC-DEC-002 | DEPENDENCY BLOCKER | No canonical delegation store/evaluator exists; delegated callers remain denied. |
| Backend create capability | WPC-DEC-011 | IMPLEMENTED | `GET /api/workspaces/capabilities` uses create authority plus required-initialization availability. Production currently returns `canCreate: false`. |
| Required Workspace `general` | WPC-DEC-025; WPC §4.4 | FAIL-CLOSED / GATED | Production registers the unavailable initializer. A valid create receives 503 before any durable mutation. |
| Canonical Workspace-channel provisioner | Messaging contract §§2, 10 | DEPENDENCY BLOCKER | Conversation has no WorkspaceChannel/default identity or uniqueness boundary. Legacy Channel/Post was not extended. |
| Workspace transaction orchestration | WPC-DEC-006/021/025 | IMPLEMENTED | Claim, Workspace, Owner, required initializer, audit, Outbox, and commit share one relational coordinator transaction. Initializer/Outbox failures roll back all staged effects. |
| Workspace create idempotency | WPC-DEC-021; WPC §13 | IMPLEMENTED | Tenant + actor + operation + SHA-256 key identity, normalized fingerprint, replay authorization, and concurrent reconciliation are preserved. |
| WPC success/error envelope | API error contract; hardening §2 | IMPLEMENTED | Changed WPC endpoints and their pre-controller failures use the full success/error envelope and canonical HTTP mapping. |
| Canonical cross-module RedactionService | API error contract | DEPENDENCY BLOCKER | No repository redaction service exists. WPC uses fixed public messages, empty details, masked targets, and `redactionApplied`; it does not claim repository-wide redactor integration. |
| Generic Project transition to Active | WPC-DEC-014/024; WPC §12.2 | IMPLEMENTED | Every status-changing request whose target is Active returns 409 `InvalidStateTransition`. |
| Never-activated archive/restore | WPC-DEC-014/024 | IMPLEMENTED | Archive produces Archived; authorized restore produces Planning, never Active. |
| Suspended recovery | WPC-DEC-014/024 | IMPLEMENTED | Suspended may return to Planning, but neither direct nor resumed generic flow may target Active. |
| Previously-active lifecycle provenance | No normative mapping found | DECISION REQUIRED | No `ActivatedAt`, audit inference, or data backfill was invented. Ambiguous recovery lands Planning. |
| Draft/ambiguous-state non-disclosure | WPC-DEC-016; governance §§5, 13 | IMPLEMENTED | Planning/Suspended require current Workspace access plus explicit Project membership across list/detail/search, Tasks, My Tasks, digest, Messaging, and realtime. Archived recovery is explicit Owner/Manager-only. |
| Canonical Workspace-scoped Project create | WPC-DEC-020; WPC §12.1 | FAIL-CLOSED / GATED | The route is absent. Deprecated `POST /api/projects` returns 503 and performs no mutation. |
| Workspace-root Project-create authority | Governance §§4, 9; WPC §12.1 | DECISION REQUIRED | The specification names no exact capability or actor predicate. |
| Non-default Visibility authority | WPC-DEC-016 | DECISION REQUIRED | The specification requires a capability but does not name it. |
| Optional Group | WPC-DEC-012 | FAIL-CLOSED / GATED | Domain/response support nullable Group, but no canonical create command is exposed. |
| Existing Project Visibility backfill | No normative mapping found | DECISION REQUIRED | No Visibility schema/default/backfill was added. |
| Project creator Owner/idempotency | WPC §§11, 13 | FAIL-CLOSED / GATED | No create succeeds until the complete atomic command can be implemented. |
| Explicit activation endpoint | WPC-DEC-024; WPC §12.2 | FAIL-CLOSED / GATED | The route is absent; PATCH/restore cannot substitute. |
| Default Project Channel | WPC-DEC-024 | DEPENDENCY BLOCKER | No canonical idempotent Conversation provisioner exists. |
| Task workflow activation mapping | WPC-DEC-024 | DEPENDENCY BLOCKER | Existing create-time workflow initialization has no approved activation compatibility rule. |
| Angular production UI | Scope rule | OUT OF SCOPE | No production frontend code was changed. |

## Workspace initialization audit

Canonical `general` provisioning: **FAIL-CLOSED / GATED**.

Production evidence:

- `UnavailableWorkspaceRequiredInitialization.IsAvailable` is false;
- `GetCapabilitiesAsync` therefore reports `canCreate: false`;
- an otherwise authorized valid POST returns 503 `DependencyUnavailable`;
- the availability gate is evaluated before the idempotency coordinator, so no
  Workspace, Owner, audit, Outbox, idempotency record, Conversation, or partial
  default is persisted.

Transaction evidence:

- injected successful initializer tests exercise only the coordinator seam;
- the successful fake is intentionally a no-op and is not `general` evidence;
- injected initializer failure tests prove rollback of Workspace, Owner, audit,
  Outbox, and the idempotency claim;
- required Outbox enqueue failure throws inside that same boundary;
- retry/concurrency tests prove one logical transaction and one side-effect set.

The current Conversation entity supports DirectMessage, ProjectChannel, and
Thread, but not an unambiguous WorkspaceChannel/default marker. Its indexes do
not enforce one default `general` per Workspace. The legacy Channel entity
requires Group scope. Consequently neither model can be used as the required
default without inventing policy or creating a competing Messaging boundary.

## Idempotency and authorization

The durable identity is:

```text
TenantId + ActorUserId + Operation + SHA-256(ClientRequestIdentity)
```

The request fingerprint hashes every normalized authoritative Workspace-create
field. Raw keys and request bodies are not stored. Create authority is checked
before both first execution and replay. Replay additionally requires the same
actor's current active Workspace membership; a revoked actor cannot recover
metadata through a Platform/SystemAdmin shortcut. Another actor, Tenant,
operation, or request fingerprint cannot reconcile the record.

The relational coordinator creates its claim inside an uncommitted transaction,
stages all business effects, saves once, and commits. It rolls back and clears
the EF change tracker on callback or persistence failure. A concurrent loser
reconciles the committed winner; it does not create a second Workspace.

## Project lifecycle audit

Production paths capable of assigning or retaining `ProjectStatus.Active`:

| Path | Final behavior |
| --- | --- |
| `ProjectService.CreateAsync` | Deprecated command returns 503 and creates nothing. Domain default for any separately constructed new Project remains Planning. |
| `ProjectService.UpdateAsync` | An already-Active row may remain Active during a metadata-only update. Any status change whose destination is Active returns 409 before audit, Outbox/invalidation, or save. |
| `ProjectService.ArchiveAsync` | Writes only Archived. |
| `ProjectService.RestoreAsync` | Clears soft-delete metadata; Archived/Deleted map to Planning. It never assigns Active. |
| Suspended recovery | Transition graph permits Planning or Archived, never Active. A subsequent attempt to target Active is independently rejected. |
| Explicit `POST /activate` | Absent. |
| Domain `Restore()` helper | Clears deletion metadata only; it does not change Project status. |
| Migrations | No migration writes Project status to Active and no activation provenance migration exists. |
| Browser-smoke seed | Test-environment-only fixture creation may construct new Active fixtures. Refresh no longer promotes an existing Planning/non-Active row to Active. |
| Direct EF/test fixtures | Trusted test setup can construct Active rows because no schema invariant/provenance exists; it is not an application/API lifecycle command. |

This closes all application/API transitions into Active. Existing Active rows
cannot be proven previously activated because the schema has no provenance.
Planning, Suspended, and Archived/Deleted histories are therefore treated
conservatively. Explicit Project members retain bounded access; broader
Workspace/Group governance does not acquire Draft visibility merely by moving
the row to Suspended or Archived. This is a compatibility restriction and is
documented as **FAIL-CLOSED / GATED**, not a final lifecycle policy.

## Draft and subordinate-resource boundary

Planning/Suspended access requires current active Workspace membership and an
explicit ProjectMember. The same predicate is applied to:

- Project list, detail, management, and search;
- Task/Artifact/Activity/Comment search;
- My Tasks projection/count/Project scope;
- deadline-digest current-state evaluation;
- project-bound Conversation creation, read/send authorization, list counts,
  and Message search;
- authorization target resolution and Project/Task realtime delivery;
- delayed `Messaging.ConversationUnreadChanged.v1` user-routed events.

Conversation membership or historical Outbox routing is not authority.
Project-bound Conversations recheck every non-null `ProjectId`, regardless
of Conversation type. Delayed unread events parse a non-empty Conversation ID
and call current Conversation authorization; malformed identity or revoked
access is denied.

## Project create status

- Workspace-scoped route: **FAIL-CLOSED / GATED**
- Optional Group: **FAIL-CLOSED / GATED**
- Create authority: **DECISION REQUIRED**
- Visibility: **DECISION REQUIRED**
- Draft non-disclosure: **IMPLEMENTED**
- Creator Owner atomicity: **FAIL-CLOSED / GATED**
- Idempotency: **FAIL-CLOSED / GATED**

The body-scoped compatibility route remains registered so existing clients
receive a deterministic safe response, but the application command returns
503 before authorization inference or mutation. There is therefore no second
successful Workspace scope, no cross-Workspace/Tenant Group binding, and no
non-idempotent Project retry.

## Activation status

- Explicit endpoint: **FAIL-CLOSED / GATED**
- Concurrency: **FAIL-CLOSED / GATED**
- Default Channel: **DEPENDENCY BLOCKER**
- Task workflow: **DEPENDENCY BLOCKER**
- Visibility validation: **DECISION REQUIRED**
- Audit: **FAIL-CLOSED / GATED**
- Outbox: **FAIL-CLOSED / GATED**
- Atomic rollback: **FAIL-CLOSED / GATED**

Activation is not exposed. This avoids marking Active before the required
default Project Channel, Task workflow compatibility, Visibility policy,
audit, Outbox, and optimistic-concurrency checks can succeed atomically.

## API contract

Changed endpoint behavior:

- `GET /api/workspaces/capabilities`
  - 200 `{ requestId, data: { canCreate }, warnings: [] }`;
  - production currently reports false because required initialization is unavailable;
  - unauthenticated/invalid current-Tenant failures use full 401/403 envelopes.
- `POST /api/workspaces`
  - future 201 is possible only when a real required initializer is available
    and the transaction commits;
  - current production valid request: 503 `DependencyUnavailable`;
  - 400: `ValidationFailed`, `MalformedJson`,
    `MissingIdempotencyKey`, or `InvalidIdempotencyKey`;
  - 403: `CapabilityDenied` or `CsrfRejected`;
  - 409: `IdempotencyConflict`;
  - 415: `UnsupportedMediaType`;
  - protected replay no longer recoverable: redacted 404 `NotFound`.
- `POST /api/projects`
  - 503 `DependencyUnavailable`, no mutation.
- `PATCH /api/projects/{projectId}` targeting Active
  - 409 `InvalidStateTransition`, target `body.status`.
- hidden `GET /api/projects/{projectId}`
  - indistinguishable full redacted 404 `NotFound`.

`Idempotency-Key` must contain 8–128 printable ASCII characters. Missing,
invalid, malformed JSON, syntactically valid type-conversion, unsupported
media type, authentication, authorization, CSRF, dependency, concurrency,
and unexpected-server cases are covered at the real HTTP boundary.

The envelope helper emits static public messages and empty details. The
canonical repository-wide `IRedactionService`/ErrorResponse profile is absent
and remains a dependency blocker; WPC does not claim to have migrated unrelated
legacy endpoints.

## Migration evidence

No remediation migration was added. The existing WPC migration is:

```text
20260813100711_Wpc01WorkspaceCreateIdempotency
```

It additively creates `idempotency_records`, the restricted actor foreign key,
and bounded actor/Tenant/resource/created-time indexes. Down drops only that
table. SQL review found no Project, Workspace, Conversation, Task, or other
business-row update. No Visibility or lifecycle-provenance column/backfill was
added.

The real PostgreSQL migration test:

- applies the prior schema and seeds an existing Project;
- upgrades to the current migration;
- verifies the Project survives and no Visibility column exists;
- rolls back to the prior migration;
- verifies the Project still survives;
- reapplies current migrations;
- verifies no pending migration or model change.

## Verification

Final verification used an isolated PostgreSQL 18 container with
`POSTGRES_TEST_CONNECTION_STRING` explicitly present for the database-backed
runs. The unset-variable focused run is reported separately and is not
PostgreSQL evidence.

| Command | Passed | Failed | Skipped | Result / qualification |
| --- | ---: | ---: | ---: | --- |
| `dotnet restore AipPortal.slnx` | n/a | n/a | n/a | Exit 0; all projects current. |
| `dotnet build AipPortal.slnx --configuration Release --no-restore --disable-build-servers -m:1` | n/a | n/a | n/a | Exit 0; 0 warnings, 0 errors. |
| `dotnet test tests/AipPortal.Tests/AipPortal.Tests.csproj --configuration Release --no-build --no-restore --filter "Scope=WPC01" --logger "console;verbosity=minimal"` with the connection variable absent | 14 | 0 | 7 | The seven conditional PostgreSQL tests explicitly skipped; this is not database evidence. |
| The same focused command with the isolated PostgreSQL connection configured | 21 | 0 | 0 | Real PostgreSQL; migration, rollback/reapply, query translation, concurrency, failure rollback, and production gating exercised. |
| `dotnet test AipPortal.slnx --configuration Release --no-build --no-restore --logger "console;verbosity=minimal"` with the isolated PostgreSQL connection configured | 884 | 0 | 0 | Full solution, including every conditional PostgreSQL test. |
| `dotnet ef migrations has-pending-model-changes --project src/AipPortal.Infrastructure --startup-project src/AipPortal.Web --configuration Release --no-build` | n/a | n/a | n/a | Exit 0: `No changes have been made to the model since the last migration.` |
| `git diff --check -- . ':(exclude)qodana.yaml'` | n/a | n/a | n/a | Exit 0. The excluded file is an unrelated pre-existing user modification. |
| Codex Security diff scan of the complete remediation patch | n/a | 0 findings | n/a | Complete coverage of all 24 deterministic changed source-like worklist rows; the one candidate discovered during review was fixed, retested, and rejected as a live finding. |

`dotnet format AipPortal.slnx --verify-no-changes --no-restore --verbosity
minimal` exited 1 on widespread pre-existing whitespace violations, including
untouched `TaskSubresourceService.cs` and `TenantIsolationSecurityTests.cs`.
No repository-wide formatting rewrite was performed.

Successful no-op initializer tests are named coordinator seam tests and are
not counted as default-`general` provisioning evidence.

## Remaining blockers

### Specification decisions

- **DECISION REQUIRED — PROJECT CREATE AUTHORITY**
- **DECISION REQUIRED — EXISTING PROJECT VISIBILITY BACKFILL**
- **DECISION REQUIRED — NON-DEFAULT PROJECT VISIBILITY AUTHORITY**
- **DECISION REQUIRED — PROJECT LIFECYCLE PROVENANCE**

### External/cross-module dependencies

- **DEPENDENCY BLOCKER — DELEGATED workspace.create CAPABILITY INFRASTRUCTURE**
- **DEPENDENCY BLOCKER — CANONICAL WORKSPACE/PROJECT DEFAULT CHANNEL PROVISIONING**
- **DEPENDENCY BLOCKER — PROJECT TASK WORKFLOW INITIALIZATION**
- **DEPENDENCY BLOCKER — CANONICAL CROSS-MODULE REDACTION SERVICE**

There is no open WPC code defect in the behaviors declared implemented above.
Unresolved behavior remains unavailable or conservatively restricted rather
than being approximated with inferred policy.
