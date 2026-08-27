# P0 Continue-working verification

Status: Issue #330 implementation candidate. Local focused Angular, production
build, architecture, and built-browser verification is recorded here. Exact PR
CI, review, and merge evidence must be read from the final pull request.

## Contract

Research is the existing Project resource. Continue working appears at the top
of the Workspace-scoped Projects landing and contains no Task cards. Opening an
authorized Project detail records that Project; opening an authorized Task
detail records only its parent Project. A File is recorded only after its
short-lived-grant Blob download succeeds, whether the action starts from Files,
Task detail, or Continue working itself.

The browser history record is versioned and partitioned by Tenant, user, and
Workspace. It stores at most eight items and each item has exactly:

- `kind`, either `project` or `file`;
- `resourceId`, a UUID; and
- `lastOpenedUtc`, a local UTC timestamp.

It stores no title, filename, status, snippet, collaborator, count, capability,
permission, authorization result, grant, token, or content. The surface
hydrates no more than three exact detail requests concurrently and displays no
more than six successfully reauthorized items.

## Authorization and failure behavior

Every card comes from a current exact `GET /api/projects/{id}` or
`GET /api/files/{id}` response whose resource and Workspace IDs match the
active scope. Server labels, statuses, and timestamps are the only rendered
metadata. `[redacted:file]` stays generic `File`. Revoked, deleted, or
mismatched records are pruned. Transient failures retain only the opaque local
record for Retry and render no stale card.

Session, Tenant, user, and Workspace changes synchronously cancel requests and
clear protected projection state. The same rule is registered with the
realtime protected-state clearer so an in-session membership invalidation also
clears immediately, even before identity signals change. Generation guards
reject late hydration, grant, and Blob responses. A Task attachment captures
its authorized Workspace and FileObject; switching Workspace before a grant or
Blob success/error produces no history, UI, permission-denial, or obsolete
Task-detail retry side effect.

File actions expose Download only. Continue working obtains a new short-lived
grant, validates the granted FileObject, sends the raw token only in the Blob
request, and touches history after the browser accepts the Blob. Grant tokens
never enter signals or storage. This feature adds no File preview, share,
collaborator, cross-device history, Task resume, or outbound provider.

The empty New Research action requires the existing server-projected
`canOpenProjectCreate` capability. Browse Files uses `canOpenWorkspace`, whose
backend policy is the same `CanViewWorkspace` boundary used for Workspace File
inventory. It does not use the distinct `canAddFiles` mutation capability.
These are presentation gates only; direct routes and APIs remain authoritative.

## Acceptance mapping

| Issue #330 criterion | Candidate evidence |
| --- | --- |
| Quickly resume recent work | Recency-sorted authorized Research/File cards at the top of the Workspace Projects landing |
| Distinguish item type and state | Lucide icon plus Research/File text, shared text-bearing server status, server update time, and local open time |
| Useful direct action | Research uses its authorized detail route; File exposes grant-backed Download with no preview route |
| Safe empty state | New Research and Browse Files appear only from their current server-projected read/create capabilities |
| Responsive and accessible | Semantic list/region, visible focus, icon-plus-text state, live feedback, axe coverage, and forced 320-pixel containment |
| No protected browser cache | Strict opaque fields only; exact GET reauthorization before rendering; tokens remain request-local |
| Revocation and concurrency safety | Realtime clearer, scope cancellation, generation guards, mismatch pruning, and late grant/Blob Workspace-switch negatives |

## Verification

Completed locally on the candidate:

- application and spec TypeScript compilation passed;
- six focused Continue-working and integration Angular files passed 145/145;
- production Angular build passed with only existing repository bundle and
  unrelated stylesheet budget warnings;
- architecture source check and architecture test suite passed; and
- the forced-320-pixel Chromium built-app scenario passed 2/2 across desktop
  and mobile projects for exact hydration, redaction, no Task request, Download,
  opaque storage, empty actions, horizontal containment, and axe.

The broader Angular run before the final focused security regressions passed
905/907; two pre-existing Files-page upload specs hit the global five-second
timeout under full-suite contention. The Files-page file passed 14/14 in the
final focused run, including both timed-out cases. This is recorded as baseline
timing evidence, not a green full-suite claim; exact-head CI remains
authoritative. Final PR-head CI status is recorded in the pull request.
The heavy contextual-selection/delete case uses the same bounded 15-second
timeout already established for Files-page integration tests; its assertions
and authorization checks are unchanged.
The Playwright API is mocked and therefore is not frontend/backend integration
or authorization evidence. This browser-local feature has no database change;
no PostgreSQL execution is claimed or required for a new persistence contract.

## Scope confirmation

- No database migration, destructive change, public API change, or
  authorization weakening is introduced.
- Existing Project/File reads and short-lived download grants stay server
  authoritative.
- The frozen U-22 release tag and SHA are unchanged; this is post-freeze main
  development.
