# File batch selection v1

Issue #348 defines a Files-page selection surface without treating browser row IDs as authority.

## Selection modes

- **This page:** local checkboxes, including Shift-click range selection, select only rows rendered on the current page.
- **All search results:** `POST /api/files/selection-snapshots` accepts the active Workspace and normalized File search/facets. The server re-evaluates the authorized result set and stores only opaque FileObject identities.
- A snapshot is bound to its actor, Tenant, Workspace, normalized query/facets, expires after five minutes, and is capped at 100 identities. `Overflow` returns no snapshot and requires the user to refine the search.
- A local selection or a new/cleared/changed search clears the browser's snapshot reference. Snapshot IDs are opaque handles, never mutation authority.

## Batch actions

`POST /api/files/selection-snapshots/{selectionSnapshotId}/delete` consumes a snapshot once. It reuses the existing single-file delete command for every captured identity, which reloads and reauthorizes each FileObject at execution. The response reports attempted, succeeded, and failed counts; deletion is explicitly best-effort and non-atomic.

Deletion remains a soft delete. The dialog states the exact count and that recovery follows the organization's policy. It must not promise a browser restore action.

Move and Share are intentionally disabled until their server command contracts are available. Download remains the existing single-file grant flow; there is no client-side multi-file download loop.

## Security and privacy requirements

- Capture requires the current actor to view the Workspace file inventory.
- Capture and execution use current Tenant filters and reauthorization; a snapshot never bypasses a revoked permission.
- Per-item failure details do not reveal whether an inaccessible resource exists.
- The client stores only an ephemeral snapshot ID/count/expiry in memory and clears it across authorization, session, Workspace, and search boundaries.
