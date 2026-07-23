# TASK-V1-PR03C detail-contract verification

Verification date: 2026-07-23

## Implemented in the working branch

- The canonical Angular route remains `/projects/:projectId/tasks/:taskId`; a loaded aggregate whose `task.projectId` differs from the route now returns the stable `TASK_DETAIL_PROJECT_MISMATCH` safe state before task content is rendered.
- The existing detail component renders Subtasks, Checklist, Comments, Labels, current-user Watch state, and Files. Checklist includes labelled **Move up** and **Move down** controls; commands use HTTP and refetch the aggregate after success or a direct-command failure.
- `AppMentionInputComponent` is an AIPsite-owned shared control. It debounces and cancels candidate requests, supports keyboard/pointer input, displays `@DisplayName`, and retains the canonical encoded user ID only in its submitted value.
- Angular-owned DTOs now retain the canonical page metadata, Task relationships/watch state, all detail permissions, and required checklist/label/subtask/comment/mention/file fields.
- Subtask and File pages are obtained through repository-level stable `Skip`/`Take` queries instead of application-layer pagination. Mention candidates are scoped to the target Project before the display-name predicate and limit are applied.
- Comment mention resolution is batched through the Project-scoped eligible-user query. Rate-limit results carry `ApplicationErrorDetail.RetryAfterSeconds`; the Task controller emits `429`, an actual `Retry-After`, and Problem Details extensions.
- File list state calculates `CanOpen` and `CanRequestDownloadGrant` through their separate canonical File authorization predicates. Aggregate/list responses do not contain grants, grant tokens, signed URLs, or storage keys.

## Commands executed

| Command | Result |
| --- | --- |
| `.tools/dotnet/dotnet.exe build AipPortal.slnx --no-restore --disable-build-servers -m:1` | Passed; 0 warnings, 0 errors. |
| `npm --prefix frontend test -- --watch=false` | Passed; 34 files, 200 tests. |
| `npm --prefix frontend run build` | Passed; existing bundle-budget warnings. |
| `npm --prefix frontend run check:architecture` | Passed. |
| `npm --prefix frontend run storybook -- --smoke-test` | Passed; Storybook reported its existing no-MDX and DefinePlugin warnings. |
| `.tools/dotnet/dotnet.exe test AipPortal.slnx --no-build --verbosity minimal` | **Not executed successfully**: Windows application-control policy blocked loading `AipPortal.Tests.dll` (`0x800711C7`) before test discovery. Unblocking the generated test output did not change the result. |

## Evidence gaps — PR remains Draft

- PostgreSQL-backed tests, migration-chain validation, OpenAPI snapshot/contract tests, real-backend Playwright smoke, and CI/Code Quality completion are not yet evidenced.
- The host lacks a configured PostgreSQL test connection and the local .NET test runner is blocked by application-control policy. No claim of PostgreSQL execution or full completion is made.
- No schema migration was added: this change uses existing Task, File, Comment, and membership data. Migration compatibility still requires PostgreSQL execution.
