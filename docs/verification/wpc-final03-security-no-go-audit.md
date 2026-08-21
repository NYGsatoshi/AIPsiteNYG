# WPC-Final03 Security No-Go Audit

## 1. Decision

**Current decision: CONDITIONAL NO-GO.**

The integrated WPC baseline contained four security-significant authorization/redaction gaps. This branch contains targeted remediations and dedicated unit/PostgreSQL acceptance coverage, but the PR remains Draft until all required CI checks pass and the branch is rechecked against the then-current `main`.

No auto-merge is permitted.

## 2. Fixed baselines

| Target | Baseline |
|---|---|
| Implementation repository | `NYGsatoshi/AIPsiteNYG` |
| Integrated implementation baseline | `31a5d2986d8a83c31fbaee22a679042a17b4335c` |
| Specification repository | `NYGsatoshi/AIPsiteNYGspec` |
| Normative specification baseline | `38339ba2964587f225c4c4151f643abb5523e862` |
| Audit PR | `#324` |
| Audit branch | `wpc-final03-security-no-go` |

The implementation baseline includes the merged WPC-02A, WPC-02B, WPC-02C, WPC-02D, WPC-02E-1, WPC-02E-2, and WPC-02F workstreams.

## 3. Normative security rules used

The audit treats the following specification requirements as merge blockers:

1. Project visibility is a discovery/read decision; it is not resource-mutation authority.
2. `WorkspaceRole.ReadOnly` cannot perform mutation.
3. Tenant membership is necessary, but not sufficient, for Workspace membership and access.
4. Cross-Tenant Workspace, Project, membership, and File relationships are prohibited.
5. Membership revocation must immediately invalidate File and other dependent authorization.
6. Unknown, legacy-unknown, incomplete, or unavailable authorization state fails closed.
7. File metadata uses the canonical `IRedactionService` and applies field policy to filename, uploader, target label, and classification.
8. Persisted historical identity and routes are attribution/context only; current authorization is authoritative.

Primary normative files:

- `docs/specs/aip-core-v4/01-core/04-permission-data-access-security.md`
- `docs/specs/aip-core-v4/01-core/11-workspace-project-governance.md`

## 4. Audited WPC surfaces

| Surface | Reviewed implementation |
|---|---|
| Project read and management | `ProjectAuthorizationService`, `ProjectReadScope` |
| Canonical Project create | `CanonicalProjectCreateService`, `WorkspaceProjectsController` |
| Project activation | `ProjectActivationService`, activation unit of work/provisioners |
| Workspace membership | `WorkspaceService`, `WorkspacesController`, Workspace `general` synchronizer |
| Capability delegation | `CapabilityGrantEvaluator`, `CapabilityGrantService` |
| File access | `FileAuthorizationService`, `FileService`, `FileRepository`, `FilesController` |
| Redaction | `IRedactionService`, canonical projection boundaries, File metadata projections |
| Notification navigation | current target resolver, notification open transaction, Angular protected-target flow |
| Archived state | Workspace/Project read and restore authorization |
| Migration fail-closed states | Project Visibility/Activation `LegacyUnknown` handling |

## 5. Findings and remediation

### F03-SEC-001 — Project read authority escalated to File mutation

**Severity: High**  
**Status: Remediated in PR #324**

`FileAuthorizationService.CanUploadAttachment` previously used `CanViewProject` for every Project-backed attachment owner. After WPC-02A, an activated `WorkspaceVisible` Project may be read by an active Workspace member without explicit Project membership. This meant a Workspace ReadOnly user or a non-Project-member reader could reach the File write path solely because Project discovery/read was allowed.

Exploit preconditions were limited but realistic:

1. active Tenant and Workspace membership;
2. `WorkspaceVisible`, activated Project;
3. attachment target resolvable to that Project;
4. no explicit Project contributor membership required.

Remediation:

- added `IProjectAuthorizationService.CanContributeProject`;
- require activated `Active`/`Review` Project state;
- require current contributing Workspace membership;
- require explicit Project role `Owner`, `Manager`, `Contributor`, or `Reviewer`;
- deny Project Viewer, Workspace ReadOnly, Planning, Completed, Suspended, Archived, Deleted, and LegacyUnknown states;
- changed File upload to use this mutation-specific decision.

### F03-SEC-002 — Historical uploader identity acted as durable delete capability

**Severity: High**  
**Status: Remediated in PR #324**

`CanDeleteAttachment` previously allowed `UploadedByUserId` or `OwnerUserId` before resolving and reauthorizing the current attachment owner scope. A former uploader could therefore retain delete authority after Workspace/Project/Conversation/Channel access was revoked.

Remediation:

- resolve the current owner target first;
- reauthorize current mutation authority for Project, Conversation, Channel, or Workspace;
- only then allow the current uploader/owner to delete;
- allow another user's Project attachment to be moderated only when the actor has both current Project contribution and Project management authority.

Historical identity is now attribution, not a capability.

### F03-SEC-003 — Canonical File metadata fields were not classified

**Severity: High for Confidential/Restricted metadata; Medium otherwise**  
**Status: Remediated in PR #324**

The canonical redaction engine had an empty `FileMetadata` confidential/restricted field map. The standard authorized field policy therefore treated filename and uploader metadata as Internal and returned it unchanged. This contradicted the specification's explicit File metadata field list.

Remediation:

- added `CanonicalFileMetadataRedactionService` as the registered `IRedactionService` boundary;
- applies canonical Confidential classification recursively to filename, uploader identity/display, target labels, and classification;
- preserves non-sensitive routing/size identifiers;
- requires explicit `ThroughConfidential` field policy to disclose those values;
- continues to delegate all non-FileMetadata profiles and all authorization-state handling to `CanonicalRedactionService`;
- verified production `AddApplication()` resolves the hardened implementation.

### F03-SEC-004 — Workspace membership admitted globally valid but wrong-Tenant users

**Severity: High**  
**Status: Remediated in PR #324**

The Workspace member command validated the global `User` but did not require a current active `TenantUser` for the Workspace Tenant. A wrong-Tenant global user could be staged as a Workspace member and then mirrored into canonical Workspace `general` membership.

Remediation:

- the HTTP command boundary checks the current non-platform Tenant context;
- requires an exact active `TenantUser` with active, non-deleted `User` and `Tenant`;
- invalid, inactive, cross-Tenant, or unavailable cases are not-found masked before Workspace mutation;
- production Workspace `general` synchronization revalidates the same Tenant/User/TenantUser state before granting Conversation participation;
- revocation remains available even after Tenant suspension because inactive Workspace membership follows the removal path.

## 6. Reviewed areas with no additional No-Go finding

### Canonical Project create

The create path revalidates current Tenant/Workspace membership, Group scope, delegated capabilities, requested Visibility, idempotency, owner membership, audit, and outbox within the canonical transaction. No new cross-Tenant or partial-write blocker was found in Final03 review.

### Project activation

Activation revalidates Project/Workspace state and authorization inside the serializable unit of work, uses expected version checks, stages Project `general` and Task workflow defaults, and commits audit/outbox with activation. No new Final03 blocker was found.

### Capability grants

Evaluation revalidates active Tenant membership, user state, scope identity, revocation, and expiry. Workspace-scoped grants also revalidate current Workspace state/membership. No new Final03 blocker was found.

### Notification open/navigation

Notification open reauthorizes the current target before read-state mutation and outbox commit. Artifact and Message navigation use current authoritative routes rather than persisted historical `targetRoute`. No new Final03 blocker was found.

### Archived and LegacyUnknown state

Archived Workspace access and restore remain explicit-member/owner constrained. Project `Visibility == null` and legacy activation state are not inferred as canonical write authority. The new File mutation boundary also fails closed for non-activated/legacy states.

## 7. Acceptance coverage

### Unit/contract tests

- `WpcFinal03FileAuthorizationTests`
  - WorkspaceVisible reader cannot upload;
  - explicit contributor can upload;
  - revoked historical uploader cannot delete;
  - current uploader may delete own attachment;
  - explicit current Project manager may moderate another attachment.
- `WpcFinal03FileMetadataRedactionTests`
  - default policy redacts all mandated File metadata fields;
  - explicit Confidential policy discloses them;
  - unknown authorization fails closed;
  - application DI resolves the hardened redaction boundary.
- `WpcFinal03WorkspaceMembershipBoundaryTests`
  - missing current Tenant membership is rejected before service mutation;
  - active exact-Tenant membership is forwarded;
  - Workspace `general` synchronization rejects a suspended Tenant membership.

### PostgreSQL acceptance

- `CrossTenantUserCannotBePersistedThroughWorkspaceGeneralAdmission`
  - uses PostgreSQL 18 and current migrations;
  - creates two Tenants and a user who belongs only to the other Tenant;
  - verifies the canonical synchronizer rejects the staged Workspace membership;
  - verifies no invalid Workspace member row is persisted.
- `WorkspaceVisibleReadDoesNotBecomeProjectFileMutationAuthority`
  - verifies a Workspace ReadOnly reader may read a WorkspaceVisible Project but cannot upload;
  - verifies an explicit Project Viewer still cannot upload;
  - verifies an explicit current Project Contributor can upload.

Dedicated gate:

- `.github/workflows/wpc-final03-security-acceptance.yml`
- PostgreSQL 18 service;
- `Scope=WPCFinal03` filter;
- exactly named required-test verification;
- minimum 14-test enforcement;
- TRX artifact retention.

## 8. Scope isolation

This Final03 PR does not modify:

- EF migrations or `AppDbContextModelSnapshot`;
- legacy migration inventory/rollout evidence;
- WPC integration acceptance matrices owned by Final01;
- migration/legacy execution material owned by Final02;
- unrelated feature code or frontend behavior.

## 9. Remaining merge gates

The PR must remain Draft until all are true:

1. `WPC-Final03 Security Acceptance` passes;
2. repository build/test, code quality, npm security, and existing WPC PostgreSQL gates are green or proven unrelated;
3. `main` has not introduced a conflicting security-sensitive change, or the branch has been rebased and re-audited;
4. PR changed-file and review-thread collision checks are clean;
5. this document is updated from `CONDITIONAL NO-GO` to the final evidence-backed decision.

A passing unit test set alone is not sufficient. PostgreSQL-backed acceptance and current-main revalidation are mandatory.
