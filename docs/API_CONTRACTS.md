# API Contracts

This document is the active API convention guide. For endpoint examples, use `docs/API_SMOKE_TESTS.http`.

Implementation note: this document describes the intended contract. The current controllers do not consistently follow one error shape or HTTP status mapping. Global exceptions return `ErrorResponse(Code, Message, TraceId)`, while many controller failures return `{ "error": "..." }` and map authorization/not-found failures to `400`. TASK-V1-PR06 adds a narrow safe envelope and typed status mapping for the Gantt snapshot, schedule/progress, and dependency routes only; it does not resolve the repository-wide mismatch. Track the broader mismatch in `docs/KNOWN_ISSUES.md`; exact controller/service findings are in `docs/BACKEND_LOGIC_AUDIT.md`.

## General Rules

- REST APIs are the source of truth for the bundled frontend.
- Controllers stay thin and call Application services.
- APIs return DTOs, never EF entities.
- Request DTOs must not expose server-managed fields unless the use case explicitly requires them.
- Use async I/O for database and file operations.
- Keep broad list APIs paginated, filtered, or otherwise bounded.
- Avoid leaking whether records exist across tenant/resource boundaries.

## Request Conventions

- Use JSON request bodies for create/update commands.
- Use route IDs for target resources.
- Use query parameters for paging, search text, filters, and sorting.
- Use server-side current tenant context; do not accept `TenantId` from normal tenant endpoint bodies.
- Use generated storage keys and server-managed ownership for uploads.

## Response Conventions

- Return response DTOs shaped for the current use case.
- Keep response fields explicit; do not expose hashes, raw tokens, secrets, storage credentials, internal file paths, or EF navigation graphs.
- Return raw API token values only once during token creation.
- Include compact metadata where useful, such as IDs, display names, status, timestamps, and current user's role/permissions.

## Errors

Target the shared error response shape from `src/AipPortal.Web/Models/ErrorResponse.cs`. Existing endpoints still need migration to this contract.

Error responses should include:

- safe message
- trace ID or correlation ID when available
- validation details for bad input when safe

Production errors must not expose stack traces, connection strings, SQL, secrets, file paths, raw request bodies, or internal exception details.

## Validation

Validate input before executing use cases:

- Required fields and length limits.
- Enum/status values.
- Date/time ordering.
- Paging bounds.
- File size, extension, and MIME type.
- Feature flag availability.
- Quota availability.

Current implementation gaps include inconsistent enum and GUID validation, missing persistence-length checks, malformed JSON escaping as server errors, nullable collection assumptions, and query date ranges that are not always validated. See `docs/BACKEND_LOGIC_AUDIT.md`.

Use Application-level validation for rules that need database state or authorization context.

## Authorization Expectations

- Authenticate protected endpoints.
- Enforce tenant access before resource access.
- Enforce resource authorization in Application services.
- Platform APIs live under `/api/platform/*` and require PlatformAdmin.
- Tenant administration APIs apply only to the current tenant.
- File download endpoints must authorize before returning bytes or storage redirects.
- Search, notifications, audit logs, exports, integrations, webhooks, and API tokens must be tenant-scoped.

## Pagination And Filtering

Use `PagedResponse<T>` for potentially large result sets.

List APIs should define:

- page number or cursor
- page size with a maximum
- allowed sort fields
- allowed filters
- tenant/resource scope

Never return unbounded tables to the browser UI.

## Project Kanban

TASK-V1-PR05 defines one vendor-neutral board over canonical Project Tasks:

- `GET /api/projects/{projectId}/kanban`
- `PUT /api/projects/{projectId}/kanban/config`
- `POST /api/tasks/{taskId}/kanban-move`

The snapshot is Project-authorized, excludes deleted records, defaults Done to
the most recent 30 days, and is bounded to at most 500 cards. Filters and
swimlanes are presentation constraints, never authorization. WIP limits
produce structured warnings rather than command denial.

Configuration and moves require current persisted versions. A move supplies
canonical Stage and neighboring Task IDs; unknown and cross-Project neighbors
return the same safe error. The HTTP response or a subsequent conflict refetch
is authoritative. Realtime events carry invalidation metadata only.

See `docs/TASK_V1_PR05.md` for ordering, transition, rollback, and permission
details.

## Canonical Project Gantt

TASK-V1-PR06 upgrades the existing Schedule route in place:

- `GET /api/projects/{projectId}/gantt`
- `PATCH /api/tasks/{taskId}/schedule`
- `PATCH /api/tasks/{taskId}/progress`
- `GET /api/tasks/{taskId}/dependencies`
- `POST /api/tasks/{successorTaskId}/dependencies`
- `DELETE /api/tasks/{successorTaskId}/dependencies/{dependencyId}?expectedVersion={version}`

The snapshot is a vendor-neutral, read-only projection. It does not persist a
Gantt row, vendor Task, date copy, progress copy, or dependency copy.

### Snapshot response

```json
{
  "projectId": "00000000-0000-0000-0000-000000000000",
  "projectTitle": "Project",
  "projectVersion": 1,
  "workflowVersion": 1,
  "calendarVersion": null,
  "calendar": {
    "timeZone": "Asia/Tokyo",
    "workingDays": [],
    "holidaysAvailable": false,
    "limitations": [
      "Workspace working-day configuration is not available in the canonical runtime.",
      "Workspace holiday data is unavailable; no holidays were inferred."
    ]
  },
  "scheduledItems": [],
  "unscheduledItems": [],
  "milestones": [],
  "dependencies": [],
  "warnings": [],
  "permissions": {
    "canEditSchedule": false,
    "canEditProgress": false,
    "canManageDependencies": false,
    "canClearSchedule": false,
    "canOpen": true
  },
  "maximumItems": 500,
  "totalItems": 0
}
```

Each item includes:

- `taskId`, `kind`, `parentTaskId`, `milestoneId`, and `title`;
- nullable `plannedStartDate`, `plannedEndDate`, and `milestoneDate` as
  day-precision `yyyy-MM-dd` values;
- `progressPercent` and `progressIsDerived`;
- `workflowStageId`, `workflowStageName`, `stageCategory`, `priority`, and
  `isBlocked`;
- nullable `primaryAssignee`;
- positive `version`;
- server-projected `scheduleEditPermissions`; and
- structured non-blocking `warnings`.

Tasks with at least one planned date appear in `scheduledItems`. Tasks with
neither date appear exactly once in `unscheduledItems` with `UNSCHEDULED`; the
server does not infer dates. Parent Task bounds/progress are derived and carry
`PARENT_DERIVED`. Compatibility Milestones appear in `milestones` with
`kind=Milestone`, one `milestoneDate`, 0/100 progress, and zero-duration
semantics. A legacy missing date carries `MILESTONE_DATE_REQUIRED`.

Each dependency includes `dependencyId`, predecessor/successor Task IDs,
string-enum `type`, `editable`, successor aggregate `version`, and warnings.
Finish-to-Start is the only authorable type. Legacy non-FS rows can be returned
as read-only inventory with `LEGACY_DEPENDENCY_TYPE`.

PR #259 was merged before its numerical limit decision was formally recorded.
On 2026-08-01, after the merge, the owner approved the existing safeguards as
the temporary PR06 full-snapshot contract: 500 combined canonical Task-kind
WorkItems and Milestones, and 2,000 active same-Project dependencies whose
endpoints are active canonical Tasks. The same item count gate applies to
snapshot, schedule, progress, and dependency paths.

When either limit is exceeded, the server MUST reject the complete snapshot
request with repository-standard typed HTTP 400
(`GANTT_ITEM_LIMIT_EXCEEDED` or `GANTT_DEPENDENCY_LIMIT_EXCEEDED`). It MUST fail
closed and MUST NOT silently truncate items or dependencies, return a partial
item set or dependency graph, or return a successful partial snapshot. The
repository rechecks the combined item bound after its bounded reads so inserts
racing the preliminary counts cannot produce an oversized response. A
successful response has `totalItems` equal to the number of rows across the
three item collections; the Angular parser rejects a mismatch.

These limits are temporary PR06 full-snapshot safety limits. They are not
permanent Project capacity limits, database storage limits, or
general-availability scalability guarantees. Paginated and virtualized
large-project Gantt delivery is deferred to
[`TASK-V1-PR06B` issue #270](https://github.com/NYGsatoshi/AIPsiteNYG/issues/270).

### Schedule and progress commands

Schedule request:

```json
{
  "plannedStartDate": "2026-08-01",
  "plannedEndDate": "2026-08-10",
  "milestoneDate": null,
  "expectedVersion": 4
}
```

Both `plannedStartDate` and `plannedEndDate` keys are required but their values
may be `null`; omitting either key is an invalid request. Clearing both moves
the Task to `unscheduledItems`. `milestoneDate` is valid only when the route ID
resolves to the canonical Milestone aggregate, in which case Task planned
dates must be `null` and the Milestone date is required. Parent-derived
schedule cannot be written. End-before-start is invalid. The command owns no
Stage, priority, Blocked, assignment, dependency, or `DeadlineAt` field.
The maintained compatibility Milestone update route likewise requires a
positive `expectedVersion`, will not activate or complete an undated
Milestone, and maps a stale Milestone revision to safe HTTP 409.

Progress request:

```json
{
  "progressPercent": 60,
  "expectedVersion": 4
}
```

`progressPercent` is required; omission is rejected rather than defaulting to
zero. Task progress is an integer from 0 through 100 and is directly writable
only for a leaf. Done Tasks remain 100; Cancelled Task progress is immutable.
Milestone progress is 0 or 100 and requires a Milestone date. Parent progress
is derived.

Parent derivation uses direct, non-deleted canonical Task-kind children only;
Milestones and non-Task rows do not contribute. The shared Task transition
contract also enforces:

- no new subtask beneath a Done/Cancelled parent until that parent is reopened;
- no terminal-child reopen while its parent remains terminal;
- parent Done only when every direct canonical Task child is Done or Cancelled
  and canonical derived progress is 100; and
- rejection of an all-cancelled child set because its derived progress is 0.

A successful schedule or progress response contains the authoritative
`taskId`, `kind`, planned/Milestone dates, progress, new `version`, and
non-blocking `warnings`. A stale expected version returns HTTP 409; clients
must refetch the HTTP snapshot before retrying. The Schedule UI preserves only
the safe edit intent across that refetch and then offers explicit Retry against
the latest version or Discard; it never silently replays a stale command.
Review-override completion applies the same parent completion guard. Restore
and delete of a child are rejected while its parent remains terminal.

### Dependency commands

Add request:

```json
{
  "predecessorTaskId": "00000000-0000-0000-0000-000000000000",
  "dependencyType": "FinishToStart",
  "expectedVersion": 4
}
```

The route Task is the successor. `predecessorTaskId` and `dependencyType` are
required, and the type is the canonical JSON string `"FinishToStart"`, not a
numeric enum. The expected version is the successor Task version. Unknown JSON
members are rejected, including `lag` and `lead`. Add rejects self, duplicate,
cycle, non-FS, cross-Project, deleted, unknown, hidden, and unauthorized
neighbors without exposing hidden metadata. Delete requires the same
successor-version check and refuses legacy non-FS rows as read-only. Neither
command moves either Task's dates. Bounded dependency inventory/cycle/warning
reads filter to active same-Project canonical Task neighbors. Visible rejected
attempts are audited with metadata-safe reason codes only. Successful
dependency and Task-lifecycle writes also advance the shared Project revision;
this makes a concurrent neighbor deletion versus dependency-add race fail
optimistically instead of committing a stale edge.

### Warnings and safe failures

Snapshot and successful command warnings are separate from blocking errors.
The vendor-neutral warning shape is:

```json
{
  "code": "DEPENDENCY_VIOLATION",
  "message": "The predecessor is planned to finish after the successor starts. No dates were changed automatically.",
  "severity": "Warning",
  "targetType": "Dependency",
  "targetId": "00000000-0000-0000-0000-000000000000",
  "field": "plannedStartDate",
  "blocking": false
}
```

PR06 warning codes are `DEPENDENCY_VIOLATION`,
`MISSING_ACTIVE_PLANNED_END`, `PARENT_DERIVED`,
`LEGACY_DEPENDENCY_TYPE`, `MILESTONE_DATE_REQUIRED`, and `UNSCHEDULED`.
A warning alone does not reject a valid command or trigger cascading movement.
Where a dependency endpoint references a parent Task, date warnings use the
canonical derived parent dates.

PR06 snapshot/command/dependency failures use:

```json
{
  "requestId": "trace-id",
  "error": {
    "code": "GANTT_STALE_VERSION",
    "message": "Work item has changed. Refetch and retry.",
    "target": null,
    "details": [],
    "redactionApplied": false
  }
}
```

The routes distinguish authentication `401`, authorization `403`, safe
not-found `404`, validation/invalid dependency `400`, and optimistic conflict
`409`. Redacted failures do not include hidden titles/neighbors, Tenant
internals, stack traces, SQL, or raw exceptions.

Request-aborted cancellation propagates and is not converted into a 500.
Unexpected snapshot exceptions return the same safe envelope with
`GANTT_REQUEST_FAILED`; unexpected schedule/progress or dependency exceptions
use their safe command failure code.

HTTP is authoritative. SignalR payloads are invalidation/version hints and are
never accepted as schedule, progress, or dependency commands. If realtime
Project subscription reauthorization is denied, the client synchronously
clears protected Kanban and Gantt state and invalidates in-flight request
generations before starting authoritative HTTP revalidation.

## Uploads

Upload endpoints must:

- Authorize the user and target resource.
- Check feature flags and quotas.
- Validate file size, extension, and MIME type.
- Store metadata in PostgreSQL.
- Store bytes through `IFileStorageService`.
- Generate tenant-namespaced storage keys.
- Return metadata DTOs, not raw filesystem paths or permanent object URLs.

Storage and metadata are separate failure domains. Upload implementations must clean up newly written bytes if metadata/audit persistence fails, and local storage should publish completed files atomically rather than writing directly to the final path.

Messaging must reference canonical, authorized file or attachment IDs. It must not accept client-supplied storage keys, stored filenames, or internal file paths as proof of an uploaded file.

## CSRF And Browser Calls

When cookie auth and `Security:EnableCsrfProtection` are enabled, unsafe browser requests must include the `X-CSRF-Token` header obtained from `GET /api/security/csrf-token`.

Safe `GET` requests do not require a CSRF token.

## Testing API Changes

For API changes, update or add tests according to risk:

- Unit/service tests for Application authorization and validation.
- HTTP integration tests for auth, CSRF, tenant resolution, and route behavior.
- Tenant isolation tests for tenant-owned resources.
- Upload tests for validation and authorization.
- API smoke examples in `docs/API_SMOKE_TESTS.http` when endpoint behavior changes.
