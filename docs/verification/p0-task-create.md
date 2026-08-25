# P0 Task-create verification

Status: Issue #410 implementation candidate. This record covers the
server-authorized Project-aware create surface only. Local backend, TypeScript,
production-build, and static-browser evidence is recorded below; PostgreSQL
and Compose real-backend evidence remain separate required gates.

## Scope and contract

The candidate preserves the legacy compatibility command
`POST /api/projects/{projectId}/tasks`. The maintained Angular flow instead
uses the canonical side-by-side routes:

- `GET /api/projects/{projectId}/tasks/create-options`
- `POST /api/projects/{projectId}/tasks/create`

Both return the canonical success envelope with `requestId`, `data`, and an
empty `warnings` collection. Create requires a strict JSON body and a
printable ASCII 8-128-character `Idempotency-Key`; cookie-authenticated POSTs
also use the normal CSRF boundary. The request contains only Task data,
optional structured Brief fields, a Project Milestone, an optional initial
primary assignee, and either `Inherit` or a complete two-boolean
`TaskOverride` source policy. Unknown JSON members, partial overrides, client
scope/version IDs, source identifiers, URLs, provider fields, and execution
instructions are rejected or absent from the contract.

The options response is a server-owned advisory projection of the readable
Project, current non-deleted Milestones, manager-visible eligible members,
current Project policy, and current capability flags. No persisted Project
policy projects the fail-closed `{ webEnabled: false, projectFilesEnabled:
false }` default at version `0`. The response does not grant authority to
write.

## Server authority and atomicity

The service checks current Project visibility and Task-create authority before
entering the idempotency coordinator, then rechecks current authority and
mutable selection targets inside the coordinator's transaction. A current Task
creator may create an unassigned Task that inherits the Project policy. Only a
current Project manager may select an initial primary assignee or persist a
complete Task override. Project/Milestone/member identity and eligibility are
validated server-side; missing, cross-Tenant, deleted, unreadable, and
wrong-Project resources use the established safe behavior.

One idempotency-owned transaction stages the Task's initial workflow placement,
automatic watches, optional `TaskExecutionScopeOverride`, required audit rows,
durable Task/assignment invalidations, and any initial-assignment notification.
Failure to stage required audit or outbox work prevents the create from
committing. The same normalized request and key recheck current Task-create
authority and return the current authoritative persisted Task/override state;
the response is not an immutable copy of original mutable fields. A different
normalized request under that key receives the canonical idempotency conflict.

The create endpoint returns HTTP 201 only after this durable Task transaction.
It does not start an execution, create `TaskExecutionRun`, persist a per-run
snapshot, call a runtime, make an outbound request, retrieve Web material,
materialize Project files, or store raw source content, provider configuration,
credentials, prompts, or outputs.

## Browser behavior

Project Detail exposes the authorized New Task route before the parameterized
Task-detail route. The form consumes only the canonical options projection,
uses the reusable structured Brief controls, supports keyboard use and compact
mobile layout, and does not render Start/runtime/Web/provider/raw-source
controls. The source-scope selection is visible only when the server projects
the appropriate manager capability; other Task creators can view the Project
policy summary but inherit it.

Issue #354 adds a local advisory review to this same form. It marks trimmed
Goal, Deliverable, and Constraints values as covered when present and offers
native focus actions for missing optional Brief fields. It also reports the
effective inherited Project policy or current manager-selected complete Task
override. A `false`/`false` policy is shown as an explicit fail-closed policy,
not as a missing source scope. The review never blocks Create, supplies no
Project Brief default, changes the create body, or claims source retrieval or
runtime behavior. See `docs/verification/p0-task-quality-checklist.md` for
its dedicated candidate evidence.

An unsent form exists only in the current browser tab. Cancel/discard confirms
when it is dirty and sends no mutation; the draft is not stored in local or
session storage. The client keeps an unchanged idempotency key for an uncertain
retry, accepts a structurally valid authoritative replay rather than requiring
obsolete mutable-field parity, records a strict HTTP 201 before follow-up
work, and uses navigation-only Task-detail recovery. Returning to the same
Project clears committed create state so a subsequent New Task form is usable.

## Recorded local verification

- Focused backend service/HTTP selection: 9 passed, 0 failed. It covers the
  canonical envelope and strict binding, idempotency/replay, safe tenant
  hiding, manager-only assignee/override authority, selection validation, and
  transactional audit/invalidation behavior.
- Full local backend suite: 951 passed, 0 failed, with 242 conditional
  PostgreSQL tests skipped because `POSTGRES_TEST_CONNECTION_STRING` was not
  configured.
- Focused Angular tests: 6 spec files / 38 tests passed under Node 24.19.0,
  including committed-recovery return/reopen behavior.
- App and spec TypeScript compilation passed. The production Angular build
  passed in 16.94 seconds under Node 24.19.0 after Task-create stylesheet
  compaction; it added no Task-create budget warning. Existing unrelated
  bundle/style warnings remain.
- A focused Chromium 320-pixel static test passed 1/1 against fresh production
  output. It covered keyboard entry, no horizontal overflow, the strict
  canonical request shape and CSRF/idempotency headers, and no Start/runtime/
  raw-provider/raw-source UI. Its API responses are mocked.
- The existing mandatory MVP0 real-backend scenario has been extended in
  source with the canonical Project Detail-to-New Task flow: exact POST body,
  CSRF/idempotency headers, HTTP 201, persisted Task/Brief detail, and no
  execution-run request.

## Limits and next evidence

- The mandatory MVP0 Compose/Playwright gate was attempted locally, but the
  Docker frontend build stopped before an application container or Playwright
  assertion ran because `SYNCFUSION_LICENSE` was not configured. Scoped
  cleanup completed. This is an environmental startup limitation, not a P0
  assertion failure or real Angular/ASP.NET Core/CSRF/DTO evidence.
- `POSTGRES_TEST_CONNECTION_STRING` was unavailable, so the conditional
  PostgreSQL suite, including provider transaction/concurrency evidence, was
  skipped. In-memory HTTP tests do not prove PostgreSQL behavior.
- Static browser evidence proves the browser contract only against mocked
  responses. It does not establish server authorization, persistence, or
  replay behavior.
- Issue #357 remains non-closing. Canonical-spec promotion and an explicit
  approved Web execution/provider and egress contract are still required
  before a future execution feature may claim Web retrieval, file
  materialization, provider behavior, or runtime output.
