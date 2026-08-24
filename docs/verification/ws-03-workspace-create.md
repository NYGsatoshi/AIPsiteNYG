# WS-03 Workspace creation verification

Status: Issue #408 implementation candidate with local frontend, backend, and
pinned-Linux mocked-browser verification complete. Provider-backed,
real-backend browser, hosted, and merge evidence is not claimed here.

## Change identity

- Branch: `feat/408-workspace-create`.
- Starting `main` baseline: `ad4baeee39db2594df653423c7fec137314c67bf`.
- The exact final PR head and hosted check results must be recorded in the PR
  because this file cannot name the commit that first contains itself.

## Canonical browser flow

The creation surface is a modal on `/workspaces`. It is reachable from the
page action when authorized and from the authorized zero-Workspace empty
state. It is intentionally not another competing primary action in the active
Workspace context header.

The form owns only:

- required `name`, trimmed and limited to 160 characters;
- optional `description`, trimmed-to-null and limited to 2,000 characters;
- optional `icon`, selected from the built-in values and limited to 120
  characters by the API contract.

The form never requests a Tenant ID, Workspace UUID, or slug. Those values are
server-owned. Duplicate display names are allowed; identity and the bounded
internal slug are generated server-side.

Cancel before submission closes the dialog without issuing a create command.
After a confirmed create whose activation is pending, dismissal does not issue
another command and reopening returns to activation recovery. While a command
or activation recovery is running, the dialog suppresses duplicate
confirmation, Escape, backdrop close, and Cancel. The facade independently
rejects a second submission while its create state is `submitting`.

## API and retry contract

`GET /api/workspaces/capabilities` is the browser's presentation source for
the create entry point. Its canonical success envelope contains
`data.canCreate`. Failure or malformed capability data removes the entry
point; it never grants authority.

`POST /api/workspaces` sends exactly:

```json
{
  "name": "Workspace name",
  "description": null,
  "icon": null
}
```

The request includes a printable ASCII `Idempotency-Key` of 8 through 128
characters. The current client generates a UUID-form value. For the same
authenticated Tenant/user and canonical trimmed payload, that key remains
stable in memory across dialog close/reopen and an uncertain network, 5xx, or
malformed-success retry. It is not persisted across a browser reload. A
changed canonical payload or authenticated identity gets a new key.

The client accepts only HTTP 201 with the complete canonical envelope:

```json
{
  "requestId": "...",
  "data": {
    "id": "00000000-0000-0000-0000-000000000001",
    "name": "Workspace name",
    "description": null,
    "icon": null,
    "status": 0,
    "createdByUserId": "00000000-0000-0000-0000-000000000002",
    "createdAt": "2026-08-24T00:00:00Z",
    "updatedAt": null
  },
  "warnings": []
}
```

The adapter requires non-empty request and resource IDs, `Active=0`, valid
timestamps, nullable optional strings, and a warnings array. A successful HTTP
status with an incompatible body is treated as uncertain; the client does not
invent or activate a resource from it.

After a verified 201, the create key is considered consumed and the client
records the returned Workspace as committed before any navigation. It refreshes
`GET /api/workspaces`, follows a replacement request when the
`WorkspaceCreated` authorization invalidation cancels the first refresh, and
requires the returned ID to appear in the current authorized projection. It
then delegates activation to the WS-02 selection boundary and remains on, or
navigates to, neutral `/workspaces`.

If the post-commit list, selection, or navigation step cannot be verified, the
state becomes `committedPendingActivation`. Retry performs only the authorized
list refresh, reconciliation, and WS-02 selection. It never repeats POST. A
successful activation updates the canonical selected Workspace, preference,
dashboard, and context header through their existing shared state.

Canonical create failures use the WPC envelope. The UI safely maps field
targets for `body.name`, `body.description`, and `body.icon`, preserves the
request ID, and uses bounded local messages rather than displaying an
arbitrary server string. Relevant server outcomes include
`ValidationFailed`, `MissingIdempotencyKey`, `InvalidIdempotencyKey`,
`CapabilityDenied`, masked replay `NotFound`, `IdempotencyConflict`, and
`DependencyUnavailable`.

## Server authorization and atomicity

The server authorizes creation in the current active Tenant for an active,
non-deleted user who is either:

- a current active Tenant `Owner` or `Admin`; or
- the subject of a current, non-revoked, non-expired Tenant-scoped
  `workspace.create` grant for that same Tenant.

Ordinary Tenant membership and a platform/SystemAdmin role alone do not grant
creation. The grant evaluator rechecks current Tenant scope, user and Tenant
membership/lifecycle, grant scope, version, effective time, expiry, and
revocation. The same authority plus canonical initialization availability
drives `canCreate`; the dialog capability check is presentation only.

The persistence-backed idempotency coordinator commits one relational
transaction containing:

- the Tenant/actor/operation/key-hash/request-hash idempotency claim;
- the active Workspace and server-generated identity;
- the creator's active Workspace `Owner` membership;
- the canonical public-within-scope `WorkspaceGeneral` Conversation and
  creator administrator participant;
- the `WorkspaceCreated` audit record; and
- required Workspace and Conversation authorization Outbox events.

Required initialization or Outbox staging failure rolls back the transaction.
Replay rechecks the same actor's current active Workspace membership before
returning protected metadata. The idempotency record stores neither the raw
key nor a copy of the raw JSON request; it stores hashes while the normal
Workspace resource fields are persisted.

## Dialog accessibility and narrow-width contract

The candidate uses the shared CDK dialog boundary for a labelled modal,
focus trap with initial focus, focus return to a surviving opener or the stable
Workspace dashboard fallback, and busy-state close suppression. Validation
provides an alert summary that receives focus after an
invalid submission, links back to the affected control, associates field help
and errors through `aria-describedby`, and does not use color alone.

Name is announced as required; Description and Icon are announced as optional.
The built-in Icon control is keyboard-operable. The dialog and form use bounded
widths and minimum-width-safe controls so their actions remain reachable at a
320-pixel viewport. The pinned Linux browser run verified keyboard containment,
Escape, focus return/fallback, validation-summary focus, axe rules, and no
horizontal overflow on desktop and mobile projects.

## Issue #408 acceptance mapping

| Acceptance criterion | Candidate evidence |
| --- | --- |
| Reachable from the Workspace flow and authorized empty state | Capability-gated `/workspaces` page action and zero-Workspace empty-state action open the same dialog |
| Name/Description/Icon without internal identity input | Reactive form owns required Name plus optional Description/Icon; UUID, Tenant, and slug are absent |
| Required/optional and validation are clear | Labels, help text, limits, inline errors, and focusable linked error summary |
| Duplicate-submit prevention | Shared-dialog busy suppression plus facade `submitting` guard |
| UI and API deny without create authority | Missing/false capability hides and blocks the client path; server independently evaluates Tenant role or delegated grant |
| Success activates the new Workspace and updates navigation | Strict 201 mapping, authoritative list refresh, and WS-02 selection; context consumers derive from canonical selection |
| Cancel creates nothing | Cancel before submission emits no command; after a committed create it only dismisses the pending activation UI and cannot repeat POST |
| Retry cannot duplicate a committed Workspace | Stable key for uncertain unchanged POST retry; verified commits move to GET/selection-only recovery |
| Keyboard, focus, and 320-pixel behavior | Shared CDK dialog boundary, linked validation summary, keyboard-native controls, and narrow-width-safe form sizing; pinned Linux desktop/mobile execution passed |

## Verification inventory and remaining gates

Completed locally on this candidate:

- traced the current Angular API adapter, facade state machine, dashboard and
  empty-state entry points, Workspace selection boundary, shared dialog
  contract, controller, Application authorization/service, capability-grant
  evaluator, canonical initializer, and persistence idempotency coordinator;
- reconciled the active documentation with the merged WPC-02B backend instead
  of the obsolete production-gated WPC-01 description;
- passed 81 focused Angular adapter/facade/dialog/dashboard/shared-primitive
  tests and the full Angular suite (595 tests);
- passed the production Angular build, architecture boundary check, and
  Storybook production build (with the same 4 GB Node heap setting as CI);
- passed the pinned Linux Angular browser suite (86 passed, 6 intentional
  skips), including eight Issue #408 desktop/mobile create-flow cases, axe,
  keyboard/focus, 320-pixel layout, and screenshot parity;
- passed 31 focused seed/Workspace-creation backend tests and the full backend
  regression suite (874 passed, 237 conditional provider tests skipped); and
- checked the source and documentation diff for whitespace errors.

The following are required before this candidate can be called merge-ready and
are deliberately not claimed by this record:

- real-backend browser coverage using an ordinary Tenant Member with only the
  delegated `workspace.create` capability, including cleanup or other
  deterministic fixture isolation;
- provider-backed Workspace create/idempotency, CapabilityGrant, and
  WorkspaceGeneral regression execution with
  `POSTGRES_TEST_CONNECTION_STRING`;
- real-host CSRF and frontend/backend contract execution; and
- exact-head hosted CI, review-thread, conflict, and merge-gate evidence.

Mocked browser tests cannot prove the backend contract or authorization.
In-memory backend tests cannot prove PostgreSQL transaction/idempotency
behavior. `POSTGRES_TEST_CONNECTION_STRING` was unavailable locally, so the
237 conditional provider tests were skipped and are not reported as
provider-backed evidence. The local real-backend Compose flow could not start
because `SYNCFUSION_LICENSE` was unavailable; hosted CI remains authoritative
for that browser/real-PostgreSQL path.

## Scope confirmation

- No production schema, migration, authorization weakening, or destructive
  data change is part of Issue #408.
- No duplicate Workspace backend, activation authority, or active-context
  implementation is introduced; the candidate binds WPC-02B to WS-02.
- Project creation, Task creation, and a general capability-grant administration
  UI remain separate work.
- Duplicate display names remain valid; no client-only uniqueness rule is
  introduced.
- A hidden action, local preference, generated key, dialog state, or successful
  mock is never treated as server authorization.
