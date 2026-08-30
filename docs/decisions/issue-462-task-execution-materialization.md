# Issue #462 authorized Project Files materialization

Status: Canonical implementation contract

Applies to: Issue #462 and `FirstPartyProjectFilesRuntimeV1`

## Server-owned input boundary

A committed Task execution run is dispatched only after the acceptance
transaction has completed. The worker receives only the opaque run identity,
tenant identity, and runtime-contract version. It re-reads the durable run under
the current tenant scope and derives the Tenant, Workspace, Project, Task,
requesting principal, and immutable source-policy snapshot from that row.

The browser cannot submit file IDs, attachment IDs, source names, URLs, paths,
storage keys, content, provider settings, or credentials. Unknown request
members remain rejected by the existing empty execution request contract.

## Current authorization and safety checks

Before materialization, the worker rechecks the current Project and Task chain
and current Project visibility for the requesting principal. Candidate input is
limited to current Task-owned attachments whose FileObject remains in the same
Tenant, Workspace, and Project. Deleted, revoked, non-active, non-Clean, or
currently unauthorized attachments are excluded.

V1 supports only bounded strict UTF-8 `text/plain` and `text/markdown`. It reads
at most 16 sources, 256 KiB per source, and 1 MiB in total through the existing
`IFileStorageService`. Unsupported, binary, invalid UTF-8, missing, or revoked
content is skipped without disclosing its identity. A canonical stored hash
mismatch fails with a bounded public failure code.

## Durable provenance

The worker persists one immutable metadata-only provenance row per materialized
Task attachment. The row contains only the canonical run, FileObject, and
Attachment IDs, the owning Tenant/Workspace/Project/Task IDs, schema version,
media type, consumed byte count, SHA-256 hash, and materialization timestamp.
It never stores raw bytes, decoded text, source names, paths, storage keys,
URLs, secrets, provider configuration, or exception details.

PostgreSQL independently verifies the run/file/attachment ownership chain,
runtime policy, scan state, active state, and approved hash at insert time. A
unique constraint prevents duplicate provenance for the same logical
run/attachment, and a trigger rejects update or deletion of provenance.

## Lifecycle and failure behavior

The runtime locks the durable run and advances it only through the canonical
`Accepted -> Queued -> Running` transitions. Materialization refusal first
enters `Running`, then records only a bounded safe terminal failure code. A
successful materialization remains `Running` for Issue #463 to atomically
persist the normal deterministic report and complete the run. Audit events are
metadata-only and never include source identity or content.
