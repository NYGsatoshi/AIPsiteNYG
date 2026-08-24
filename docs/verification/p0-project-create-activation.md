# P0 Project create and activation verification

Status: Issue #409 implementation complete with local source, unit, build,
architecture, Storybook, and pinned-Linux mocked-browser evidence recorded
below. Provider-backed PostgreSQL, real-backend browser, hosted exact-head, and
merge evidence remain explicitly pending; this document does not treat mocked
UI behavior as backend proof.

## Canonical flow

The full create entry is available from Projects and from the Workspace setup
action. A Workspace-scoped route owns its route Workspace; the global Projects
route uses only the currently selected authorized Workspace. The client never
chooses the first Workspace or derives authority from a role label.

Before opening the form, the browser reads:

`GET /api/workspaces/{workspaceId}/projects/create-options`

The strict WPC envelope supplies the matching `workspaceId`, whether an
ungrouped Project may be created, the exact allowed Visibility values, and
only named active Groups where the actor may create. Internal Group IDs are
never typed by the user. A valid false/empty response means no create scope.

The dialog submits only:

```json
{
  "title": "Project name",
  "description": null,
  "groupId": null,
  "visibility": 1,
  "startDate": null,
  "endDate": null
}
```

Title is required and limited to 200 characters. Description is optional and
limited to 4,000 characters. Group and dates are optional when the projected
scope permits them; an end date cannot precede the start date. MembersOnly is
the safe default and only backend-projected Visibility choices are rendered.
There is no initial-member picker: canonical creation atomically makes the
creator the sole Project Owner, and membership changes are separate commands.

## Idempotency and committed recovery

The canonical POST is `/api/workspaces/{workspaceId}/projects` and carries a
printable `Idempotency-Key`. One key is bound in memory to the authenticated
Tenant/user, Workspace, and canonical trimmed payload. It is reused across an
unchanged network, 5xx, or malformed-success retry and changes only when that
scope or payload changes.

The client accepts only HTTP 201 with the complete WPC envelope and a response
matching the requested Workspace, Group, normalized values, Planning status,
MembersOnly or the requested allowed Visibility, NeverActivated state,
positive version, and valid timestamp. A malformed 2xx is uncertain and
retains the key.

After a strict 201, the mutation is recorded as committed before list refresh,
authorization invalidation, confirmation, or navigation. The client refreshes
the Workspace-scoped Project list and confirms the returned Project through
`GET /api/projects/{projectId}`. If confirmation or navigation fails, the
dialog enters committed-pending-navigation state. Closing and reopening that
state exposes only GET/navigation recovery; it can never issue another create
POST. Session, Tenant, or actual Workspace loss clears the protected state.

## Draft and activation boundary

The created Project is shown as user-facing Draft: canonical Planning,
NeverActivated, and non-operational. The Overview distinguishes Project-owned
values from values generated on activation. It does not request Tasks,
Kanban, Gantt, workload, or members while the Project remains in that exact
Draft shape. Existing readable Review, Completed, Suspended, and migrated
legacy Projects retain their established operational projections.

Only backend `uiPermissions.canActivate=true` exposes the separate Activate
action. Activation sends:

```json
{
  "expectedVersion": 1
}
```

to `POST /api/projects/{projectId}/activate`. The browser accepts only HTTP 200
with a WPC envelope whose `data.projectId` matches the current Project. Success,
conflict, transport uncertainty, and malformed success all lead to an
authoritative Project GET before another activation can be offered. Only a
confirmed activated Project loads the operational projections. The server
independently rechecks the active Workspace, Project management authority,
canonical Visibility, NeverActivated Planning state, and exact version before
atomically provisioning ProjectGeneral and the Task workflow.

## Accessibility and responsive contract

The shared CDK dialog supplies its accessible name, focus trap, initial focus,
busy close suppression, and focus return. Invalid submission focuses a linked
error summary. Labels distinguish required and optional values, candidate
Groups are searchable by name, all actions remain keyboard reachable, and the
form uses a one-column narrow layout without horizontal overflow at 320
pixels. Draft and activation state is expressed in text, not color alone.

## Verification inventory

Completed locally on 2026-08-24:

- the full backend solution passed 888 tests with zero failures; 240
  environment-conditional tests were skipped;
- the full Angular suite passed 72 files and 720 tests, and the production
  build, architecture boundary check, and architecture script tests passed;
- Storybook built successfully with a 3 GB Node heap after the default 2 GB
  local attempt exhausted its heap; the successful build emitted only the
  repository's existing size warnings;
- focused create, activation, route-reuse, authorization-boundary, idempotency,
  focus, and mapper regressions passed, including 52 Project-detail facade
  tests after the final cross-actor Draft reconciliation change;
- the preceding candidate's pinned Linux Docker runner rebuilt the production
  Angular application and passed 96 Playwright cases with 6 intentional skips;
  after the authorization-recheck correction, the focused Project
  create/Draft/activation journey passed again locally on desktop and
  320-pixel mobile. Exact corrected-head Linux parity remains a hosted gate; and
- `git diff --check` passed with only expected Windows working-copy line-ending
  notices.

Still required from hosted exact-head gates before merge:

- PostgreSQL-backed create-option authority, scoped-list translation,
  dashboard command-count, and activation transaction coverage;
- the required real-backend browser journey through create, Draft
  confirmation, creator ownership, explicit activation,
  ProjectGeneral/workflow provisioning, and deterministic archive cleanup;
  and
- the complete CI matrix, clean merge state, and no unresolved review threads.

`POSTGRES_TEST_CONNECTION_STRING` is not configured locally, so the 240 skips
include provider tests and are not PostgreSQL evidence. `SYNCFUSION_LICENSE`
is also unavailable locally, so the licensed real-backend Compose journey was
not started. Mocked browser responses are not frontend/backend integration
evidence.

The first hosted candidate passed PostgreSQL, frontend, security, session,
My Tasks, and five of six real-backend P0 scenarios. Its Project-create
scenario exposed a delayed authorization-invalidation race: protected create
options correctly cleared, but the Projects page also mistook the transient
Workspace loading interval for a real scope switch and discarded the local
form before POST. The corrected page now retains only local form values while
the dashboard is loading, requires a same-Workspace authoritative affordance
before reloading protected options, and closes on capability loss, no access,
or a real Workspace change. The corrected exact-head real-backend rerun is
still mandatory.

## Scope confirmation

- No schema migration, destructive data change, authorization weakening, or
  initial-member mutation is introduced.
- The title-only Research Quick Create remains separate and ungrouped.
- The deprecated unscoped Project-create route remains disabled.
- Project activation remains a distinct authorized command; creation never
  auto-activates.
