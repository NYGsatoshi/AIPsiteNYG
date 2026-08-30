using Npgsql;

namespace AipPortal.Tests.PostgreSql;

[Collection("PostgreSqlTaskV1")]
[Trait("Scope", "Issue364")]
public sealed class ResearchPlanPostgreSqlTests
{
    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task CurrentRevisionMustBelongToTheSamePlan()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var first = await TaskV1MigrationRawSqlSeed.CreateGraphAsync(database, $"research-plan-a-{Guid.NewGuid():N}");
            var second = await TaskV1MigrationRawSqlSeed.CreateGraphAsync(database, $"research-plan-b-{Guid.NewGuid():N}");
            var third = await TaskV1MigrationRawSqlSeed.CreateGraphAsync(database, $"research-plan-c-{Guid.NewGuid():N}");
            var firstPlanId = Guid.NewGuid();
            var secondPlanId = Guid.NewGuid();
            var firstRevisionId = Guid.NewGuid();
            var secondRevisionId = Guid.NewGuid();
            var deferredPlanId = Guid.NewGuid();
            var deferredRevisionId = Guid.NewGuid();
            var now = new DateTimeOffset(2026, 8, 30, 0, 0, 0, TimeSpan.Zero);

            await InsertPlanAsync(database, first, firstPlanId);
            await InsertPlanAsync(database, second, secondPlanId);
            await InsertRevisionAsync(database, first, firstPlanId, firstRevisionId, now);
            await InsertRevisionAsync(database, second, secondPlanId, secondRevisionId, now);

            await PostgreSqlMigrationTestDatabase.ExecuteAsync(database, """
UPDATE research_plans
SET "CurrentRevisionId" = @firstRevisionId
WHERE "Id" = @firstPlanId;
UPDATE research_plans
SET "CurrentRevisionId" = @secondRevisionId
WHERE "Id" = @secondPlanId;
""",
                ("firstPlanId", firstPlanId), ("firstRevisionId", firstRevisionId),
                ("secondPlanId", secondPlanId), ("secondRevisionId", secondRevisionId));

            var definition = await PostgreSqlMigrationTestDatabase.ScalarAsync<string>(database, """
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'FK_research_plans_research_plan_revisions_CurrentRevisionId_Id';
""");
            Assert.Contains(
                "FOREIGN KEY (\"CurrentRevisionId\", \"Id\") REFERENCES research_plan_revisions(\"Id\", \"ResearchPlanId\")",
                definition,
                StringComparison.Ordinal);
            Assert.Equal(
                "true:true",
                await PostgreSqlMigrationTestDatabase.ScalarAsync<string>(database, """
SELECT condeferrable::text || ':' || condeferred::text
FROM pg_constraint
WHERE conname = 'FK_research_plans_research_plan_revisions_CurrentRevisionId_Id';
"""));

            await InsertDeferredFirstRevisionAsync(
                database,
                third,
                deferredPlanId,
                deferredRevisionId,
                now);

            var invalidPointer = await Assert.ThrowsAsync<PostgresException>(() =>
                PostgreSqlMigrationTestDatabase.ExecuteAsync(database, """
UPDATE research_plans
SET "CurrentRevisionId" = @secondRevisionId
WHERE "Id" = @firstPlanId;
""", ("firstPlanId", firstPlanId), ("secondRevisionId", secondRevisionId)));
            Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, invalidPointer.SqlState);
        });
    }

    private static Task InsertDeferredFirstRevisionAsync(
        string database,
        TaskV1MigrationRawSqlSeed.Graph graph,
        Guid planId,
        Guid revisionId,
        DateTimeOffset now) =>
        PostgreSqlMigrationTestDatabase.ExecuteAsync(database, """
BEGIN;
INSERT INTO research_plans
    ("Id", "TenantId", "WorkspaceId", "ProjectId", "TaskItemId", "CurrentRevisionId", "VersionNo")
VALUES
    (@planId, @tenantId, @workspaceId, @projectId, @taskId, @revisionId, 1);
INSERT INTO research_plan_revisions
    ("Id", "TenantId", "WorkspaceId", "ProjectId", "TaskItemId", "ResearchPlanId", "RevisionNo", "CreatedByUserId", "CreatedAtUtc")
VALUES
    (@revisionId, @tenantId, @workspaceId, @projectId, @taskId, @planId, 1, @userId, @now);
COMMIT;
""",
            ("planId", planId), ("revisionId", revisionId), ("tenantId", graph.TenantId),
            ("workspaceId", graph.WorkspaceId), ("projectId", graph.ProjectId),
            ("taskId", graph.TaskId), ("userId", graph.UserId), ("now", now));

    private static Task InsertPlanAsync(
        string database,
        TaskV1MigrationRawSqlSeed.Graph graph,
        Guid planId) =>
        PostgreSqlMigrationTestDatabase.ExecuteAsync(database, """
INSERT INTO research_plans
    ("Id", "TenantId", "WorkspaceId", "ProjectId", "TaskItemId", "CurrentRevisionId", "VersionNo")
VALUES
    (@planId, @tenantId, @workspaceId, @projectId, @taskId, NULL, 1);
""",
            ("planId", planId), ("tenantId", graph.TenantId), ("workspaceId", graph.WorkspaceId),
            ("projectId", graph.ProjectId), ("taskId", graph.TaskId));

    private static Task InsertRevisionAsync(
        string database,
        TaskV1MigrationRawSqlSeed.Graph graph,
        Guid planId,
        Guid revisionId,
        DateTimeOffset now) =>
        PostgreSqlMigrationTestDatabase.ExecuteAsync(database, """
INSERT INTO research_plan_revisions
    ("Id", "TenantId", "WorkspaceId", "ProjectId", "TaskItemId", "ResearchPlanId", "RevisionNo", "CreatedByUserId", "CreatedAtUtc")
VALUES
    (@revisionId, @tenantId, @workspaceId, @projectId, @taskId, @planId, 1, @userId, @now);
""",
            ("revisionId", revisionId), ("tenantId", graph.TenantId), ("workspaceId", graph.WorkspaceId),
            ("projectId", graph.ProjectId), ("taskId", graph.TaskId), ("planId", planId),
            ("userId", graph.UserId), ("now", now));
}
