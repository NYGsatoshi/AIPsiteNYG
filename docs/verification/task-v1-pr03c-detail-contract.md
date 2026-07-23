# TASK-V1-PR03C detail-contract verification

Verification date: 2026-07-23

## Implemented surface

- `GET /api/tasks/{taskId}` returns `CanonicalTaskDetailResponse`, with the compact command DTO nested as `task` and bounded first pages for comments (20), files (20), and subtasks (50).
- The aggregate includes relationships, actor-relative detail permissions, the ordered checklist, applied Labels only, and current-user Watch state.
- The existing Project-scoped Angular route consumes the aggregate and only renders a Task found under the matching route Project ID.
- `PUT /api/tasks/{taskId}/checklist/order` validates the complete ID set, uses the parent Task version, assigns deterministic sparse sort keys, and commits one Task version increment.
- Task comments call the shared `ICommunicationSafetyGuard`; rejected safety decisions return the Task comment machine codes. Mention candidates are tenant-filtered through the active-user search and current Project visibility check.
- File association DTOs expose access state and grant eligibility without returning a grant, token, signed URL, or storage key.

## Commands run

| Command | Result |
| --- | --- |
| `.tools/dotnet/dotnet build AipPortal.slnx --no-restore` | Passed, 0 warnings / 0 errors |
| `.tools/dotnet/dotnet test AipPortal.slnx --no-build --verbosity minimal` | Passed, 283 tests |
| `npm --prefix frontend run check:architecture` | Passed |
| `npm --prefix frontend run build` | Passed; existing bundle-budget warnings reported |
| `npm --prefix frontend test` | Passed, 199 tests |

## Environment qualification

The local PostgreSQL connection string was not configured, so the repository's conditional PostgreSQL tests may return early. No Docker-backed or real-backend Playwright evidence was run in this environment. The .NET SDK 10.0.301 used for the checks was installed locally under ignored `.tools/dotnet` and is not part of this change.
