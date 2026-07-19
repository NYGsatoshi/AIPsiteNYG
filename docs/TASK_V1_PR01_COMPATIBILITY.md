# Task v1 PR01 compatibility and rollback

This migration extends the existing `TaskItem` / `task_items` aggregate; it does not rename the CLR type, table, routes, DTOs, or remove legacy planning fields.

- `TaskPriority.Normal` rows become the single canonical persisted value `Medium`. `Normal` is intentionally not an enum alias, so string transport and database conversion remain unambiguous.
- Legacy `Status` remains unchanged. It selects the initial canonical workflow stage: NotStarted→Todo, InProgress→InProgress, WaitingReview→Review, Completed→Done, Cancelled→Cancelled. Blocked becomes `IsBlocked=true` and gets a bounded migration marker; it uses InProgress only for exactly one non-conflicting legacy assignee, otherwise Todo.
- `StartDate` and `DueDate` are copied to planned dates. They are never treated as `DeadlineAt`, and no `CompletedAt` value is fabricated.
- Every Project receives the deterministic Backlog, Todo, In Progress, Review, Done, Cancelled workflow. Review enforcement is enabled by default and takes effect only in the later command cutover when a Reviewer is present.
- Exactly one legacy Assignee/Reviewer is copied to the canonical scalar only when unambiguous. A reviewer equal to that assignee is left null. `Support` creates a collaborator row; `Owner` is retained only as legacy assignment data. Ambiguities and non-FS dependencies are retained in `task_migration_inventory` for operator review.
- Existing dependency rows are not converted. SS/FF/SF values are inventoried and remain readable until a later cutover.
- `tasks.domainV1` is a tenant feature key, default-enabled with the existing feature-key convention. It is a rollout selector for later canonical compatibility reads/commands, never an authorization control; migrations and database integrity rules are unaffected when it is disabled.

The generated `Down` migration necessarily drops additive columns/tables and cannot reconstruct their values into legacy fields. Production rollback therefore means disabling `tasks.domainV1` first, retaining the upgraded schema, and using a separately reviewed restore procedure rather than applying `Down` to a database containing canonical writes.
