# P0 structured Report reader and Evidence Inspector

Issue #373 implements the Option A contract: an immutable structured Report document belongs one-to-one to an `ArtifactVersion`. Sections contain bounded plain text and server-validated UTF-16 citation spans that reference exact per-version Claims; Claims and Sections also carry stable logical lineage IDs.

## Boundaries

- `POST /api/artifact-versions/{artifactVersionId}/report` attaches the complete manifest once, under current Artifact update authority. Duplicate ordinals, overlapping/out-of-range anchors, and Claims from another ArtifactVersion fail before persistence.
- `GET /api/projects/{projectId}/artifact-versions/{artifactVersionId}/report` is the normal Project reader. An optional `taskId` binds Task routes to the exact Task-owned Artifact.
- The response contains ordered, pre-split text/citation render runs. It reauthorizes each Evidence source and entirely omits inaccessible Evidence, without hidden totals or placeholders.
- The Angular Project and Task Report routes keep citation selection local. Desktop uses a sticky right Inspector; narrow screens use a full-screen secondary view without horizontal scrolling. Closing restores focus to the triggering citation.
- No arbitrary Report HTML, raw source body, storage reference, provider configuration, or Audit metadata is projected.

PostgreSQL deployment requires `20260831120000_AddStructuredArtifactReports`. Existing Claim rows receive `LogicalClaimId = Id` during migration.
