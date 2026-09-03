# Audit Finding Structured Decision Contract v1

Issue: #376

## Purpose

Record the reviewer outcome for a canonical Audit Finding as structured data instead of inferring completion from comments, notes, or triage state.

## Identity and separation

- Every decision references the canonical `ArtifactFinding.Id` introduced by Issue #372.
- Finding triage (`Open`, `Reviewing`, `Resolved`, `AcceptedRisk`, `FalsePositive`) remains a separate workflow concern.
- Comments/notes do not create a structured decision and therefore do not mark review complete.
- `ReviewCompleted` is true only when at least one authorized structured-decision revision exists.

## Decision values

The v1 structured values are:

- `NoIssue`
- `NeedsFix`
- `AcceptedRisk`

The API returns option metadata, including whether a rationale is mandatory. In v1 `AcceptedRisk` requires a non-empty rationale. The server is authoritative for this policy; the client mirrors it for immediate validation.

## Append-only history

`audit_finding_decisions` is an append-only revision table. Each revision stores:

- decision;
- previous decision, when one exists;
- rationale, when supplied;
- reviewer user ID;
- reviewer display-name snapshot;
- immutable creation timestamp.

The newest authorized revision is the current decision. Re-saving an identical decision+rationale is an idempotent no-op. A rationale change on the same decision creates a new revision.

PostgreSQL rejects UPDATE and DELETE against the decision table, so history cannot be rewritten through a later application path.

## Authorization and non-disclosure

### Read

`GET /api/admin/audit/findings/{findingId}/decision` resolves the Finding through its canonical Claim and reuses the Claims & Evidence authorization projection. A Finding outside the caller's current authorized Claim/Evidence scope is returned through the generic not-available boundary.

### Mutation

`PUT /api/admin/audit/findings/{findingId}/decision` requires `audit.review` before mutation and then re-runs the parent Claim/Evidence authorization. The server validates the decision value, rationale policy, and 1000-character rationale bound.

Generic AuditLog metadata records only the structured state transition (`fromDecision`, `toDecision`, completion flag). Free-text rationale is not copied into broad Audit metadata.

## UI behavior

The Finding detail pane contains a dedicated Review decision panel. It:

- shows whether review is complete independently of triage and comments;
- shows current Decision, Reviewer, Rationale, Timestamp, and Previous decision;
- lets authorized reviewers save a structured decision;
- disables mutation when `CanReview` is false;
- uses server-provided `RationaleRequired` option metadata;
- exposes append-only decision history;
- remains usable at a 320px viewport without horizontal page overflow.
