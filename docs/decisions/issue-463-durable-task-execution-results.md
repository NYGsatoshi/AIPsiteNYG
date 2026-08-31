# Issue #463 durable Task execution result contract

Status: Canonical contest result contract

Applies to: Issue #463 after the Project Files materialization boundary in #462.

## Decision

A successful logical `TaskExecutionRun` owns exactly one normal server-owned
`TaskExecutionResult`. The result is distinct from the
`ArtifactVersion -> Claim -> Evidence` graph and does not create or mutate Audit
claims or evidence.

The result stores only:

- the immutable Tenant, Workspace, Project, Task, and run ownership chain;
- schema version `1` and terminal `Succeeded` status;
- the fixed bounded title `Project Files Analysis Report`;
- a bounded deterministic Markdown report;
- the SHA-256 hash of that report;
- authoritative completion/creation timestamps; and
- immutable links to the metadata-only materialized-source rows from #462.

There is a unique database identity per run. Result rows and their source links
are immutable after insertion. PostgreSQL guards reject cross-Tenant,
cross-Workspace, cross-Project, cross-Task, or cross-run source references.

## Runtime transaction

`DurableTaskExecutionResultRuntime` is the concrete
`FirstPartyProjectFilesRuntimeV1` worker. It re-reads and locks the accepted run,
advances the canonical lifecycle, reauthorizes the current Task/Project and
each current clean Task-associated Project File, reads only bounded strict
UTF-8 `text/plain` or `text/markdown` through `IFileStorageService`, and verifies
an approved file hash when one exists.

For a successful run, metadata-only source provenance, the deterministic report,
all result-source links, the `Running -> Succeeded` transition, and the success
audit signal commit in one database transaction. A rollback therefore cannot
leave a public successful run without its normal result. Idempotency replay or
runtime redispatch returns the same logical run/result rather than creating a
second result.

The report proves real materialization through approved media type, byte count,
content hash, materialization time, and bounded line/word statistics. It never
persists or returns raw source text, file names, paths, object keys, provider
configuration, credentials, prompts, stack traces, or exception text.

## Read authorization

The normal result endpoints are:

- `GET /api/tasks/{taskItemId}/execution-result`
- `GET /api/tasks/{taskItemId}/execution-runs/{runId}/result`

Every read reauthorizes the current caller against the current Task and Project.
Before returning a successful report, the server also revalidates every linked
source association, Tenant/Workspace/Project/Task chain, active/nondeleted file
state, clean scan state, media type, byte size, approved hash, and current file
view authorization. Any revocation or mismatch returns the same redacted
not-found contract and exposes no source identity, count, state, or report
content.

A non-terminal or failed run may return only the lifecycle timestamps, terminal
state when applicable, and a bounded safe failure code. Repository or integrity
failure maps to a generic service-unavailable response without raw diagnostics.

## Frontend behavior

The Task detail source-scope panel continues to render the authoritative
Accepted, Queued, Running, Succeeded, and Failed run states. Once the latest run
is `Succeeded`, a dedicated result component reads the normal server endpoint
and renders the report as escaped preformatted text. It does not interpret the
Markdown as HTML. Authorization loss and not-found responses collapse to a
generic empty state.
