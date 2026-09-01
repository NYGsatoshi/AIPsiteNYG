# Audit Source Provenance Contract v1

Status: canonical additive contract for Issue #358. It extends `audit-claims-evidence-v1.md` without changing its ArtifactVersion ownership or authorization boundaries.

## Ownership and trust boundary

Source provenance is an immutable snapshot attached to an authorized `ArtifactEvidence` item owned by one immutable `ArtifactVersion`.

`Artifact -> ArtifactVersion -> Claim -> Evidence -> Source provenance`

The source reference remains opaque and never grants authority. Audit must reauthorize the owning Artifact and each repository-backed source before any source title, reference, passage, provenance value, source identity, count, or trace target is projected.

## Retained source-level metadata

An evidence item may retain:

- display-safe source title
- publisher
- source type
- source classification: `Unknown`, `Primary`, or `Secondary`
- published timestamp
- retrieved timestamp
- content hash
- source version
- source verification status: `Unverified`, `Verified`, or `Rejected`
- citation location
- optional related Audit event ID

Publisher, type, hash, and version are bounded strings. Published time cannot be later than retrieved time when both are supplied.

Repeated Evidence references to the same `(SourceKind, SourceReference)` within one manifest must use identical source-level provenance values. Passage and citation location remain Evidence-level and may differ per citation occurrence.

## Source identity and duplicate detection

The server derives a stable opaque `SourceId` only after source authorization. It hashes the source kind plus normalized source reference and exposes only a short opaque identifier such as `src_<hex>`.

The identifier exists only for grouping and duplicate/reference detection. It is not a database key, credential, capability, signed URL, or authorization input.

Repository-backed GUID references are normalized before hashing so equivalent textual GUID forms map to the same source identity. Web snapshot references remain opaque apart from surrounding whitespace removal.

The UI may compute duplicate/reference counts only from Evidence items already returned by the authorized Claims & Evidence projection. It must not request or infer hidden-source totals.

## Read projection

The existing endpoint remains:

`GET /api/admin/audit/claims-evidence?artifactVersionId={guid}`

Each authorized evidence item may additionally include:

- `sourceId`
- `sourcePublisher`
- `sourceType`
- `sourceClassification`
- `publishedAt`
- `retrievedAt`
- `contentHash`
- `sourceVersion`
- `verificationStatus`

Unknown client classifications are rendered fail-closed as `Unknown` / `Unverified`; malformed opaque source IDs and malformed timestamps are discarded by the client mapping layer rather than displayed as server-provided text.

## UI contract

The Claims & Evidence comparison pane shows authorized source provenance adjacent to the selected bounded passage. Citation location and all authorized Claim/Evidence occurrences sharing the same opaque source ID are visible so reviewers can identify duplicate use.

`Claim -> Evidence -> Source -> Event` is progressive disclosure. The provenance trace is collapsed by default and opens only through the explicit `Trace provenance` control. A related Event link is emitted only when the server has already authorized and projected that Event ID; there is no disabled placeholder that reveals a hidden Event.

The source-usage count is explicitly an authorized-projection count, not a total source-use count across inaccessible Claims or sources.

## Persistence

Migration `20260901023000_AddArtifactEvidenceProvenance` adds the optional provenance snapshot columns plus required defaulted classification and verification columns to `artifact_evidence`.

Existing evidence rows remain valid with:

- `SourceClassification = Unknown`
- `VerificationStatus = Unverified`
- all other new provenance values null

The evidence tables remain append-only and are still owned by the explicit evidence-schema migration contract.

## Security invariants

- no provenance field is projected before the existing source reauthorization boundary;
- unauthorized sources are omitted entirely, including source ID and duplicate/reference counts;
- source ID never authorizes retrieval;
- no outbound Web request is triggered by opening provenance;
- raw Audit metadata is not parsed to reconstruct provenance;
- hidden Event existence is not disclosed;
- no source-level provenance inconsistency is accepted for duplicate references in the same immutable manifest;
- UI mapping rejects unknown provenance enums/IDs/timestamps instead of displaying arbitrary server text.
