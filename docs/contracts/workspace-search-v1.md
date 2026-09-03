# Workspace Search Contract v1

Status: active

Owner: Issue #329

Files-page facet extension: Issue #341

## Purpose

Workspace Search provides one visible entry point for the current Workspace and returns only the two resource families required by the Workspace UI:

- `Research / Project`, backed by the canonical `Project` aggregate.
- `File`, backed by the canonical Workspace Files inventory.

This contract does not redefine global search and does not create a second authorization model.

## Request contract

The Workspace UI issues type-specific authenticated reads to the existing endpoint:

```http
GET /api/search?q={query}&type=Project&workspaceId={workspaceId}&page=1&pageSize={bounded}
GET /api/search?q={query}&type=File&workspaceId={workspaceId}&page=1&pageSize={bounded}
```

Rules:

- `workspaceId` is mandatory for `File` search.
- The query is trimmed and must not be empty.
- The UI does not use `type=All` for this surface, so unrelated authorized result types cannot appear in the Workspace result panel.
- The UI never treats a client-side active Workspace value as authorization; both reads remain server-authorized.

The non-empty query rule above applies to the Workspace-header entry point. The
Files page may issue a File-only request with no `q` when at least one supported
facet is active:

```http
GET /api/search?type=File&workspaceId={workspaceId}&q={optionalName}&fileKind={kind}&fromDate={utcInstant}&authorUserId={currentUserId}&page={page}&pageSize={bounded}
```

- `fileKind` is one of `Document`, `Image`, `Pdf`, `Video`, or `Archive`.
  Categories are mutually exclusive; `Document` is the fallback for a File
  that is not an image, PDF, video, or ZIP archive.
- `fromDate` implements the Files UI's Last 7/30/90 days choices against
  `UpdatedAt`, falling back to `CreatedAt` for legacy rows.
- The Files UI exposes Owner as `Anyone` or `Uploaded by me`. The latter sends
  only the current authenticated user's opaque ID; Issue #341 does not add a
  user-directory or uploader-enumeration contract.
- A File facet is rejected when `type` is not exactly `File`; an unknown
  `fileKind` value is rejected rather than treated as the unfiltered default.

## Research / Project results

`Research` is the Workspace UI label for the existing canonical `Project` aggregate. Project results continue to use `VisibleProjectsFor(actor)` and the requested Workspace filter before a title, description, route, or count can contribute to the response.

The result route is the canonical Project detail route:

```text
/projects/{projectId}
```

## File results

File search is deliberately bounded to the same records as the current Workspace Files inventory:

- the Attachment belongs directly to the requested Workspace;
- `OwnerType == Workspace`;
- `OwnerId == workspaceId`;
- neither the Attachment nor its FileObject is deleted;
- the FileObject is not in the Deleted state;
- the actor may currently view the active Workspace, or is an authorized platform administrator under the existing Workspace-read rule.

Project, Task, Conversation, Channel, Comment, Activity, and Artifact-Version attachments are excluded. Exposing those records requires their owner-specific authorization and navigation contracts and is outside Workspace Search v1.

File results contain:

- opaque FileObject ID;
- server-authorized displayed filename;
- current Workspace ID;
- created time;
- generic Workspace Files route.

For the Files-page facet extension, the same authorized result may additionally
carry only the row metadata already needed by the Files inventory and preview
gate: content type, byte size, FileObject status, normalized scan status, and
updated time. The common author display field is the uploader label. Search
does not project `canDelete`; filtered rows are fail-closed for mutation and
every preview/download still uses the existing short-lived grant boundary.

They contain no body/content snippet, storage key, internal path, token, hash,
raw scan metadata, permission list, uploader ID, or hidden-owner metadata.

The result route is:

```text
/workspaces/{workspaceId}/files
```

The Files page remains the authority for opening or downloading the selected file. Workspace Search v1 does not bypass the existing grant/download boundary.

## Non-disclosure behavior

- An unreadable, inactive, deleted, or mismatched Workspace contributes zero File results.
- The response does not distinguish an unreadable Workspace from an authorized Workspace with no matching files.
- The Workspace UI displays only returned authorized items and does not expose an independent server total for omitted or unauthorized records.
- Search errors use a fixed client-owned message and never render response bodies or stack traces.
- Stale responses are discarded after Workspace or query generation changes.
- A Files-page response containing a non-File row, mismatched Workspace ID,
  malformed identity, or invalid paging envelope is rejected as a whole; its
  row and total are not rendered.

## Frontend behavior

- The search field is visible in the Workspace header and names its scope: files, Research, and Projects in the current Workspace.
- Standard keyboard tab navigation reaches the field; `Ctrl+K` / `Cmd+K` focuses it without submitting.
- Results use text labels for resource type and remain operable with keyboard and touch.
- A Workspace change clears the previous query, results, status, and pending request.
- No result is retained across a missing or changed active Workspace.
- The Files page keeps name search and Type, Modified, and Owner controls in
  one landmark. Applied facets remain visible as individually removable chips.
- Result rows reuse the maintained Files grid/mobile list and preview/download
  grant flow. Backend Search remains the sole owner of filtered result membership
  and `totalCount`; the browser does not filter an inventory page and call it a total.

## Explicit non-goals

- Project/Task/Message attachment search;
- content or OCR search;
- snippets from file bodies;
- saved searches or command-palette commands;
- cross-Workspace search;
- count aggregation across unauthorized scopes;
- direct file download from the Workspace-header result panel (the Files-page
  extension still goes through the maintained short-lived grant flow).
- folder scope, folder hierarchy, Cited/Research, source type, and Language facets.
