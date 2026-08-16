from pathlib import Path
import re


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, got {count}")
    p.write_text(text.replace(old, new, 1))


# 1. Project lifecycle typed-error regression.
# Keep Deleted Projects non-operational, but preserve the typed lifecycle error for
# an explicitly authorized historical Project manager/owner.
project_service = "src/AipPortal.Application/Projects/ProjectService.cs"
replace_once(
    project_service,
    '''    public async Task<Result> ArchiveAsync(Guid projectId, CancellationToken cancellationToken = default)\n    {\n        if (!TryCurrentUser(out var userId) || !await projectAuthorization.CanManageProject(userId, projectId, cancellationToken))\n        {\n            return Result.Failure("You are not allowed to manage this project.");\n        }\n\n        var project = await projects.GetProjectAsync(projectId, cancellationToken);\n        if (project is null)\n        {\n            return Result.Failure("Project not found.");\n        }\n\n        if (project.DeletedAt.HasValue || project.Status is ProjectStatus.Archived or ProjectStatus.Deleted)\n''',
    '''    public async Task<Result> ArchiveAsync(Guid projectId, CancellationToken cancellationToken = default)\n    {\n        if (!TryCurrentUser(out var userId))\n        {\n            return Result.Failure("You are not allowed to manage this project.");\n        }\n\n        var canManage = await projectAuthorization.CanManageProject(userId, projectId, cancellationToken);\n        var project = await projects.GetProjectAsync(projectId, cancellationToken);\n        if (project is null)\n        {\n            return Result.Failure("Project not found.");\n        }\n\n        var isDeletedTerminalState = project.DeletedAt.HasValue || project.Status == ProjectStatus.Deleted;\n        if (!canManage &&\n            !(isDeletedTerminalState && await CanReceiveTerminalLifecycleErrorAsync(userId, project, cancellationToken)))\n        {\n            return Result.Failure("You are not allowed to manage this project.");\n        }\n\n        if (project.DeletedAt.HasValue || project.Status is ProjectStatus.Archived or ProjectStatus.Deleted)\n''')

replace_once(
    project_service,
    '''    public async Task<Result> RestoreAsync(Guid projectId, CancellationToken cancellationToken = default)\n    {\n        if (!TryCurrentUser(out var userId) || !await projectAuthorization.CanManageProject(userId, projectId, cancellationToken))\n        {\n            return Result.Failure("You are not allowed to manage this project.");\n        }\n\n        var project = await projects.GetProjectAsync(projectId, cancellationToken);\n        if (project is null)\n        {\n            return Result.Failure("Project not found.");\n        }\n\n        var message = project.Status is ProjectStatus.Archived or ProjectStatus.Deleted\n''',
    '''    public async Task<Result> RestoreAsync(Guid projectId, CancellationToken cancellationToken = default)\n    {\n        if (!TryCurrentUser(out var userId))\n        {\n            return Result.Failure("You are not allowed to manage this project.");\n        }\n\n        var canManage = await projectAuthorization.CanManageProject(userId, projectId, cancellationToken);\n        var project = await projects.GetProjectAsync(projectId, cancellationToken);\n        if (project is null)\n        {\n            return Result.Failure("Project not found.");\n        }\n\n        var isDeletedTerminalState = project.DeletedAt.HasValue || project.Status == ProjectStatus.Deleted;\n        if (!canManage &&\n            !(isDeletedTerminalState && await CanReceiveTerminalLifecycleErrorAsync(userId, project, cancellationToken)))\n        {\n            return Result.Failure("You are not allowed to manage this project.");\n        }\n\n        var message = project.Status is ProjectStatus.Archived or ProjectStatus.Deleted\n''')

replace_once(
    project_service,
    '''    private static Result<T> ProjectNotFound<T>() =>\n''',
    '''    private async Task<bool> CanReceiveTerminalLifecycleErrorAsync(\n        Guid userId,\n        Project project,\n        CancellationToken cancellationToken)\n    {\n        // This grants no operational mutation authority. It only preserves the\n        // typed terminal-state error for a current explicit Project manager.\n        var workspaceMember = await workspaces.GetMemberAsync(project.WorkspaceId, userId, cancellationToken);\n        if (workspaceMember is not { Status: MembershipStatus.Active })\n        {\n            return false;\n        }\n\n        var projectMember = await projects.GetMemberAsync(project.Id, userId, cancellationToken);\n        return projectMember?.Role is ProjectRole.Owner or ProjectRole.Manager;\n    }\n\n    private static Result<T> ProjectNotFound<T>() =>\n''')

# 2. Gantt: WPC-02A adds exactly three authoritative parent-Workspace reads.
replace_once(
    "tests/AipPortal.Tests/PostgreSql/TaskV1Pr06GanttHostedHttpTests.cs",
    '''            Assert.Equal(24, authorizedSnapshotCommands.Count);''',
    '''            // WPC-02A adds three authoritative Workspace status/membership reads so\n            // archived-parent authorization cannot be bypassed by Project membership.\n            Assert.Equal(27, authorizedSnapshotCommands.Count);''')

# 3. Historical raw-SQL migration fixture must adapt to the migration schema it is seeding.
raw_seed = Path("tests/AipPortal.Tests/PostgreSql/TaskV1MigrationRawSqlSeed.cs")
raw_text = raw_seed.read_text()
pattern = re.compile(
    r'''        await PostgreSqlMigrationTestDatabase\.ExecuteAsync\(connectionString, """\nINSERT INTO tenants .*?\n            \("projectSlug", \$"migration-project-\{suffix\}"\), \("now", now\), \("deletedAt", deletedTask \? now : null\)\);''',
    re.S,
)
replacement = '''        var hasActivationState = await PostgreSqlMigrationTestDatabase.ScalarAsync<long>(\n            connectionString,\n            """\nSELECT COUNT(*)\nFROM information_schema.columns\nWHERE table_schema = current_schema()\n  AND table_name = 'projects'\n  AND column_name = 'ActivationState';\n""") > 0;\n\n        await PostgreSqlMigrationTestDatabase.ExecuteAsync(connectionString, """\nINSERT INTO tenants ("Id", "Name", "Slug", "DisplayName", "Status", "CreatedAt")\nVALUES (@tenantId, @name, @slug, @name, 'Active', @now);\nINSERT INTO users ("Id", "DisplayName", "Email", "NormalizedEmail", "PasswordHash", "Status", "SystemRole", "FailedLoginAttempts", "CreatedAt")\nVALUES (@userId, 'Migration user', @email, @normalizedEmail, 'hash', 'Active', 'User', 0, @now);\nINSERT INTO workspaces ("Id", "TenantId", "Name", "Slug", "Status", "CreatedByUserId", "CreatedAt")\nVALUES (@workspaceId, @tenantId, 'Migration workspace', @workspaceSlug, 'Active', @userId, @now);\n""",\n            ("tenantId", tenantId), ("userId", userId), ("workspaceId", workspaceId),\n            ("name", $"Migration tenant {suffix}"), ("slug", $"migration-tenant-{suffix}"),\n            ("email", $"migration-{suffix}@example.test"), ("normalizedEmail", $"MIGRATION-{suffix}@EXAMPLE.TEST"),\n            ("workspaceSlug", $"migration-workspace-{suffix}"), ("now", now));\n\n        var projectInsertSql = hasActivationState\n            ? """\nINSERT INTO projects ("Id", "TenantId", "WorkspaceId", "Name", "Slug", "Status", "OwnerUserId", "CreatedByUserId", "CreatedAt", "ActivationState")\nVALUES (@projectId, @tenantId, @workspaceId, 'Migration project', @projectSlug, 'Active', @userId, @userId, @now, 'LegacyUnknown');\n"""\n            : """\nINSERT INTO projects ("Id", "TenantId", "WorkspaceId", "Name", "Slug", "Status", "OwnerUserId", "CreatedByUserId", "CreatedAt")\nVALUES (@projectId, @tenantId, @workspaceId, 'Migration project', @projectSlug, 'Active', @userId, @userId, @now);\n""";\n        await PostgreSqlMigrationTestDatabase.ExecuteAsync(\n            connectionString,\n            projectInsertSql,\n            ("projectId", projectId), ("tenantId", tenantId), ("workspaceId", workspaceId),\n            ("projectSlug", $"migration-project-{suffix}"), ("userId", userId), ("now", now));\n\n        await PostgreSqlMigrationTestDatabase.ExecuteAsync(connectionString, """\nINSERT INTO task_items ("Id", "TenantId", "WorkspaceId", "ProjectId", "Title", "Status", "Priority", "ProgressPercent", "SortOrder", "CreatedByUserId", "CreatedAt", "Kind", "IsBlocked", "SortKey", "VersionNo", "DeletedAt")\nVALUES (@taskId, @tenantId, @workspaceId, @projectId, 'Migration task', 'Todo', 'Medium', 0, 0, @userId, @now, 'Task', false, 1024, 1, @deletedAt);\n""",\n            ("taskId", taskId), ("tenantId", tenantId), ("workspaceId", workspaceId), ("projectId", projectId),\n            ("userId", userId), ("now", now), ("deletedAt", deletedTask ? now : null));'''
raw_text, count = pattern.subn(replacement, raw_text, count=1)
if count != 1:
    raise RuntimeError(f"raw SQL seed replacement count={count}")
raw_seed.write_text(raw_text)

# 4. WPC-01 migration test is a historical boundary test, not a latest-model test.
wpc01 = "tests/AipPortal.Tests/PostgreSql/Wpc01WorkspaceCreationPostgreSqlTests.cs"
replace_once(
    wpc01,
    '''    private const string PreviousMigration = "20260803041347_AddTaskDeadlineDigestLedger";''',
    '''    private const string PreviousMigration = "20260803041347_AddTaskDeadlineDigestLedger";\n    private const string Wpc01Migration = "20260813100711_Wpc01WorkspaceCreateIdempotency";''')
replace_once(
    wpc01,
    '''            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);\n\n            Assert.True(await TableExistsAsync(database, "idempotency_records"));''',
    '''            await PostgreSqlMigrationTestDatabase.MigrateAsync(database, Wpc01Migration);\n\n            Assert.True(await TableExistsAsync(database, "idempotency_records"));''')
replace_once(
    wpc01,
    '''            await using (var current = PostgreSqlMigrationTestDatabase.CreatePlatformContext(database))\n            {\n                Assert.Empty(await current.Database.GetPendingMigrationsAsync());\n                Assert.False(current.Database.HasPendingModelChanges());\n            }\n\n''',
    '''            // Current-model pending-migration/model checks belong to the current\n            // WPC-02A acceptance suite, not this historical WPC-01 boundary test.\n\n''')
replace_once(
    wpc01,
    '''            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);\n            Assert.True(await TableExistsAsync(database, "idempotency_records"));''',
    '''            await PostgreSqlMigrationTestDatabase.MigrateAsync(database, Wpc01Migration);\n            Assert.True(await TableExistsAsync(database, "idempotency_records"));''')

# 5. Workspace detail denial is canonical safe-not-found for cross-tenant/outsider IDs.
tenancy = "tests/AipPortal.Tests/Tenancy/HttpTenantIsolationTests.cs"
replace_once(
    tenancy,
    '''        await AssertBadRequestAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/workspaces/{data.WorkspaceB.Id}");''',
    '''        await AssertStatusAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/workspaces/{data.WorkspaceB.Id}", HttpStatusCode.NotFound);''')
replace_once(
    tenancy,
    '''        await AssertBadRequestAsync(app, data.Outsider, data.TenantA.Slug, $"/api/workspaces/{data.WorkspaceA.Id}");''',
    '''        await AssertStatusAsync(app, data.Outsider, data.TenantA.Slug, $"/api/workspaces/{data.WorkspaceA.Id}", HttpStatusCode.NotFound);''')

# Temporary patch infrastructure must never remain in the PR diff.
for temporary in [
    ".github/workflows/wpc02a-ci-fix-temp.yml",
    ".github/workflows/wpc02a-ci-fix-runner-temp.yml",
    ".github/workflows/wpc02a-ci-fix-apply-temp.yml",
    "tools/wpc02a_ci_fix_temp.py",
]:
    p = Path(temporary)
    if p.exists():
        p.unlink()
