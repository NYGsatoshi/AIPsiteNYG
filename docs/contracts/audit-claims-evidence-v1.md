# Audit Claims & Evidence Contract v1

Status: canonical for Issue #340 implementation.

## Decision

Claims and evidence are owned by an immutable `ArtifactVersion`. Audit never treats `AuditLog.MetadataJson`, browser state, or a mutable Task as the source of truth for report claims.

The minimal retained evidence material is a bounded passage snapshot required to verify a claim. The system does **not** persist an entire remote source body through this contract.

## Ownership graph

`Artifact -> ArtifactVersion -> Claim -> Evidence -> Source reference`

An `ArtifactVersion` is the immutable report/version boundary. Claims and evidence attached to a version do not move when a later artifact version is uploaded.

## Persistence

### ArtifactClaim

Required fields:

- `Id`
- `TenantId`
- `ArtifactVersionId`
- `Ordinal`
- `Text`
- `CitationPresent`
- `SupportStatus`
- `ReviewStatus`
- `CreatedAt`

`SupportStatus` is one of `Unverified`, `Supported`, `Unsupported`, `Contradicted`, `Insufficient`.

`ReviewStatus` is one of `Unreviewed`, `Reviewed`.

### ArtifactEvidence

Required fields:

- `Id`
- `TenantId`
- `ArtifactClaimId`
- `Ordinal`
- `SourceKind`
- opaque `SourceReference`
- optional display-safe `SourceTitleSnapshot`
- bounded `PassageSnapshot`
- optional `LocationSnapshot`
- optional `SourceEventAuditId`
- `CreatedAt`

`PassageSnapshot` is immutable and bounded to 4,000 Unicode characters. `SourceTitleSnapshot` is bounded to 512 characters. `SourceReference` is bounded to 2,048 characters and is treated as an opaque reference, not as authority to retrieve data.

This contract does not add outbound Web retrieval, provider credentials, or full-source retention.

## Authorization

1. The caller must first have `audit.view`.
2. The caller must be able to view the owning Artifact through `IArtifactAuthorizationService.CanViewArtifact`.
3. Evidence is returned only if its source can be reauthorized at read time.
4. `ArtifactVersion` file-backed evidence uses the existing Artifact/File authorization boundaries; inaccessible evidence is omitted completely rather than redacted with title/count/snippet placeholders.
5. A Web source snapshot has no separately addressable repository resource in v1. It is visible only when the owning Artifact is visible; the contract exposes the bounded snapshot and opaque source reference that were captured with that version. No network re-fetch is performed.
6. Cross-tenant, malformed, missing, and unauthorized resource identifiers are observationally equivalent from the Claims & Evidence endpoint.

The browser must never infer authorization from citation presence, counts, or hidden controls.

## Read API

`GET /api/admin/audit/claims-evidence?artifactVersionId={guid}`

Response is a bounded claim-first projection. Maximum 200 claims per request and 20 evidence items per claim. The service rejects or truncates persisted data outside those bounds without exposing hidden totals.

Each claim projection includes:

- claim ID and ordinal
- claim text
- `citationPresent`
- `supportStatus`
- `reviewStatus`
- authorized evidence items only

Each evidence item includes:

- evidence ID and ordinal
- source kind
- display-safe source title snapshot when authorized
- passage snapshot
- location snapshot
- optional authorized Audit event ID for trace navigation

The endpoint does not expose source counts before authorization, raw audit metadata, actor IDs, request metadata, provider credentials, or full source bodies.

## UI contract

`/app/admin/audit` contains a dedicated `Claims & Evidence` view alongside the event log.

The view is claim-first. Citation presence and support verification are separate visible states. Selecting a claim renders the Claim and its authorized Source passage side by side on desktop and stacked on narrow screens. `Unsupported`, `Contradicted`, and `Insufficient` are explicit text states rather than color-only conditions.

Trace links may navigate to an authorized related Audit event via the existing `event` query parameter. If no authorized event is projected, no placeholder or disabled link reveals its existence.

## Mutation boundary

Issue #340 is a verification workspace. This v1 contract does not create a new Audit Review mutation. Support/review status is persisted with the immutable artifact evidence set by the producer/importer boundary. A later issue may add a separately authorized review command without changing the ownership model.

## Security invariants

- no client-side reconstruction of Claims/Evidence from raw metadata;
- no hidden-data counts;
- no raw `metadataJson` dependency;
- no cross-tenant source title/reference/snippet leakage;
- no Web request triggered by opening Audit;
- no Claim/Evidence fallback from a newer ArtifactVersion;
- passage snapshots are immutable once attached to an ArtifactVersion.
