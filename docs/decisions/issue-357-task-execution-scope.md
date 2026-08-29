# Issue #357 Task execution-scope promotion decision

Status: Approved foundation scope; not a canonical-spec completion

Approved: 2026-08-25

Applies to: [Issue #357](https://github.com/NYGsatoshi/AIPsiteNYG/issues/357)

Implementation baseline: `7b524ddbf1cd62db96b96744a0afd40ffee31501`

Canonical specification baseline:
`AIPsiteNYGspec@38339ba2964587f225c4c4151f643abb5523e862`

The canonical Task contract currently retains Task automation/bots as Deferred.
This owner-approved repository decision authorizes a narrow, fail-closed
foundation only. It does not amend the external canonical specification, and
an implementation PR for this decision MUST say `Addresses #357` rather than
close it until the corresponding canonical-spec promotion and a Web execution
provider contract are approved.

## Approved first-release boundary

1. Source kinds are Web scope and authorized Project files only. App/provider
   integrations remain out of scope.
2. A Project owns one default execution scope. A Task either inherits that
   default or owns one complete explicit override; there is no partial merge of
   Project and Task values.
3. Each accepted execution-run request captures an immutable, server-built
   scope snapshot in the same transaction as the run record. Later scope edits
   apply only to future runs.
4. The first release exposes no outbound Web retrieval, crawling, search,
   provider credentials, raw source-content persistence, or provider-specific
   behavior. The built-in runtime port fails closed as unavailable.

## Scope semantics

The effective scope projection contains only the following source policy:

| Source | State | Meaning |
| --- | --- | --- |
| Web | Disabled | No Web source is eligible. |
| Web | Enabled | A future, separately approved runtime may consider Web sources only after its egress and provider contract is approved. |
| Project files | Disabled | Project files are not a source. |
| Project files | Enabled | A future runtime may resolve currently authorized, clean Project files server-side at execution time. |

The foundation stores only these two booleans. It does not store URLs, site
hosts, provider configuration, file names/IDs/counts, page bodies, or file
bytes. Project-file eligibility is re-evaluated by a future runtime under
current authorization and file-state rules; the immutable snapshot freezes the
scope policy, not a stale file list. New and migrated Project defaults are
fail-closed with both source kinds disabled.

## Authorization, redaction, and change rules

- Every Project default and effective Task scope read requires current Task or
  Project read authorization. Missing, cross-Tenant, cross-Workspace, or
  unauthorized resources have the repository's indistinguishable safe result.
- Project default mutation, Task override mutation, and run requests require
  current Project-management authority; neither client visibility nor an
  inherited default grants authority.
- The server computes effective inheritance and permissions. The browser never
  derives a scope from Project metadata or file lists.
- The UI may display only the authorized enabled/disabled policy. It describes
  Project files generically and does not expose names, counts, URLs, or other
  source descriptors.
- Scope changes, Task override changes, run requests, and unavailable-runtime
  results are audited. Existing generic Project/Task invalidation hints may be
  used; no raw scope, source, file, or execution payload is sent through
  realtime.

## Run snapshot and runtime boundary

A run snapshot contains only:

- Tenant, Workspace, Project, Task, requester, and creation identity;
- whether the source was inherited or a Task override;
- the Web-enabled policy; and
- the Project-files enabled flag.

The application reads and copies the policy snapshot inside idempotent request
staging, before asking the foundation `ITaskExecutionRuntime` port for its
deterministic unavailable outcome. That call occurs during request staging,
not as a committed job dispatch, so the only registered port does no external
I/O. A future provider must not be registered on this path: it needs a
separately approved, post-commit durable dispatch design and may receive only
a server-built, authorization-scoped snapshot handle. That later design must
define egress, URL and redirect/SSRF, query/input, result retention,
source-content, credential, audit, and cancellation policies before being
enabled.

## Acceptance consequences

The first release must prove:

1. Project default versus Task override effective projections and the two
   enabled/disabled source flags;
2. authorization and cross-scope redaction on reads, edits, and run requests;
3. immutable historical snapshots after a later Project or Task scope edit;
4. no source content, file metadata, or credentials in run persistence,
   audit, or realtime payloads;
5. the fail-closed unavailable runtime produces no outbound request; and
6. Task UI summary/editor accessibility and responsive behavior.

It must not claim an executable Web research flow or canonical completion of
Issue #357.
