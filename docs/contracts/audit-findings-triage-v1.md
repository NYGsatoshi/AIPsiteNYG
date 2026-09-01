# Audit Findings Triage Contract v1

Issue: #372

## Purpose

Provide a canonical, authorization-safe triage queue for risk and policy findings without mutating or duplicating the immutable `ArtifactVersion -> ArtifactClaim -> ArtifactEvidence` verification graph.

## Canonical identity

- A Finding is represented by `ArtifactFinding`.
- Each `ArtifactFinding` belongs to exactly one canonical `ArtifactClaim` (`ArtifactClaimId`, unique).
- Claim and Evidence content remain immutable after an evidence manifest is attached.
- Finding detector metadata is supplied with that immutable manifest and is not edited by the triage workflow.
- Downstream structured decisions may reference the stable `ArtifactFinding.Id`.

## Finding metadata

Each Finding stores these independent fields:

- `Severity`: `Low | Medium | High | Critical` — expected impact.
- `ConfidencePercent`: integer `0..100` — detector certainty. Confidence is not derived from Severity.
- `DetectorKey`: bounded detector/rule identity.
- `PolicyVersion`: bounded policy/rule-set version.

## Triage state

The only v1 states are:

- `Open`
- `Reviewing`
- `Resolved`
- `AcceptedRisk`
- `FalsePositive`

A new Finding starts as `Open`.

`AcceptedRisk` and `FalsePositive` transitions require a non-empty reason. The current reason is stored on the Finding for fast inspection. Every mutation also appends an `AuditFindingHistory` row containing the previous status, resulting status, resulting owner, reason supplied for that transition, actor, and timestamp.

Triage mutation never rewrites Claim/Evidence content or detector metadata.

## Ownership

When the caller has `audit.review`, the Findings response includes a bounded list of active users in the Finding tenant as eligible owners. A reviewer may assign any eligible owner or clear the owner. The server revalidates that a selected owner is still an active tenant member and active user at mutation time; stale or cross-tenant owner IDs are rejected.

Current Owner display is projected only while that user remains an active member of the Finding's tenant. The stable owner user ID remains part of the authorized Finding state.

## Authorization and non-disclosure

### Read

`GET /api/admin/audit/findings` does not independently enumerate Findings first. It first resolves the requested Artifact version through the canonical Claims & Evidence projection, which requires `audit.view`, current Artifact authorization, and current source authorization.

Only Findings whose canonical Claim IDs exist in that authorized projection may be returned. The Finding and parent Claim tenant IDs must also agree. Related Evidence and Event links are derived only from already-authorized Evidence projection entries. A hidden Evidence row, source title, passage, location, reference, or Event ID is never recovered from the Finding query.

Eligible owner options are returned only when `CanReview` is true and are limited to active users in the same tenant as the Finding.

### Mutation

`PATCH /api/admin/audit/findings/{findingId}/triage` requires `audit.review` and then re-runs the canonical Claims & Evidence authorization for the Finding's parent Artifact version. A Finding outside the current authorized scope, or one whose tenant does not agree with its parent Claim, is returned through a generic not-available boundary.

Owner assignment is separately revalidated against active tenant membership. The Audit log records that a triage/owner change occurred and its status/owner summary, but does not duplicate the free-text resolution reason into generic Audit metadata.

## Query and prioritization

Supported query fields:

- `artifactVersionId` (required)
- `status` (optional)
- `severity` (optional)
- `openOnly=true` (optional; `Open` and `Reviewing`)

Default ordering is deterministic for triage work:

1. unresolved (`Open` / `Reviewing`) before terminal outcomes;
2. Severity `Critical -> High -> Medium -> Low`;
3. Confidence descending;
4. Created time ascending.

The server returns at most 200 authorized Findings per request in v1. A Finding history projection returns at most the newest 50 entries. Eligible owners are bounded to 500 active tenant users.

## UI behavior

The Findings workspace:

- keeps Status and Severity filters URL-reproducible;
- displays Severity and Confidence as separate values;
- shows and configures Owner, and shows Detector, Policy version, Claim text, current outcome reason, and state history;
- provides direct authorized navigation to the related Claim/Evidence and Event when available;
- disables mutation when `CanReview` is false;
- validates Accepted Risk / False Positive reasons client-side in addition to the server validation;
- remains usable without horizontal page overflow at a 320px viewport.

## Downstream contract

Issue #376 (structured Decision) must reference `ArtifactFinding.Id` rather than introducing another parallel Finding identity. Issue #379 may layer workflow ownership/deadline semantics on the same stable Finding/Decision chain.
