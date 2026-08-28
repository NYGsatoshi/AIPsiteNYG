# Workspace Search Contract v1

Status: active

Owner: Issue #329

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

They contain no body/content snippet, storage key, token, hash, scan details, permission list, or hidden-owner metadata.

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

## Frontend behavior

- The search field is visible in the Workspace header and names its scope: files, Research, and Projects in the current Workspace.
- Standard keyboard tab navigation reaches the field; `Ctrl+K` / `Cmd+K` focuses it without submitting.
- Results use text labels for resource type and remain operable with keyboard and touch.
- A Workspace change clears the previous query, results, status, and pending request.
- No result is retained across a missing or changed active Workspace.

## Explicit non-goals

- folder hierarchy or folder search;
- Project/Task/Message attachment search;
- content or OCR search;
- snippets from file bodies;
- saved searches or command-palette commands;
- cross-Workspace search;
- count aggregation across unauthorized scopes;
- direct file download from the search result.
