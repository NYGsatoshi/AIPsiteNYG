using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace AipPortal.Tests.PostgreSql;

[Collection("PostgreSqlTaskV1")]
[Trait("Scope", "WPC02A")]
public sealed class Wpc02AProjectGovernancePostgreSqlTests
{
    private const string Wpc01BaseMigration = "20260813100711_Wpc01WorkspaceCreateIdempotency";

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task ExistingProjectUpgradesToLegacyUnknownWithoutInventingVisibilityOrActivationMetadata()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async testConnectionString =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(testConnectionString, Wpc01BaseMigration);
            var graph = await TaskV1MigrationRawSqlSeed.CreateGraphAsync(testConnectionString, "wpc02a-legacy");

            await PostgreSqlMigrationTestDatabase.MigrateAsync(testConnectionString);

            var rows = await PostgreSqlMigrationTestDatabase.QueryAsync(
                testConnectionString,
                """
                SELECT "Visibility", "ActivationState", "ActivatedAtUtc", "ActivationVersion",
                       "SuspendedFromStatus", "ArchivedFromStatus"
                FROM projects
                WHERE "Id" = @projectId;
                """,
                reader => new LegacyProjection(
                    reader.IsDBNull(0) ? null : reader.GetString(0),
                    reader.GetString(1),
                    reader.IsDBNull(2) ? null : reader.GetFieldValue<DateTimeOffset>(2),
                    reader.IsDBNull(3) ? null : reader.GetInt32(3),
                    reader.IsDBNull(4) ? null : reader.GetString(4),
                    reader.IsDBNull(5) ? null : reader.GetString(5)),
                ("projectId", graph.ProjectId));

            var project = Assert.Single(rows);
            Assert.Null(project.Visibility);
            Assert.Equal("LegacyUnknown", project.ActivationState);
            Assert.Null(project.ActivatedAtUtc);
            Assert.Null(project.ActivationVersion);
            Assert.Null(project.SuspendedFromStatus);
            Assert.Null(project.ArchivedFromStatus);

            await using var context = PostgreSqlMigrationTestDatabase.CreatePlatformContext(testConnectionString);
            Assert.Empty(await context.Database.GetPendingMigrationsAsync());
            Assert.False(context.Database.HasPendingModelChanges());
        });
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task DatabaseRejectsPublicLegacyUnknownVisibilityAndFabricatedActivatedState()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async testConnectionString =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(testConnectionString, Wpc01BaseMigration);
            var graph = await TaskV1MigrationRawSqlSeed.CreateGraphAsync(testConnectionString, "wpc02a-constraints");
            await PostgreSqlMigrationTestDatabase.MigrateAsync(testConnectionString);

            var visibilityError = await Assert.ThrowsAsync<PostgresException>(() =>
                PostgreSqlMigrationTestDatabase.ExecuteAsync(
                    testConnectionString,
                    "UPDATE projects SET \"Visibility\" = 'LegacyUnknown' WHERE \"Id\" = @projectId;",
                    ("projectId", graph.ProjectId)));
            Assert.Equal(PostgresErrorCodes.CheckViolation, visibilityError.SqlState);
            Assert.Equal("CK_projects_visibility", visibilityError.ConstraintName);

            var activationError = await Assert.ThrowsAsync<PostgresException>(() =>
                PostgreSqlMigrationTestDatabase.ExecuteAsync(
                    testConnectionString,
                    """
                    UPDATE projects
                    SET "ActivationState" = 'Activated',
                        "ActivatedAtUtc" = NULL,
                        "ActivationVersion" = NULL
                    WHERE "Id" = @projectId;
                    """,
                    ("projectId", graph.ProjectId)));
            Assert.Equal(PostgresErrorCodes.CheckViolation, activationError.SqlState);
            Assert.Equal("CK_projects_activation_provenance", activationError.ConstraintName);
        });
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task ArchivedWorkspaceReadScopeRequiresCurrentMembershipEvenForSystemAdmin()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async testConnectionString =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(testConnectionString, Wpc01BaseMigration);
            var graph = await TaskV1MigrationRawSqlSeed.CreateGraphAsync(testConnectionString, "wpc02a-archived");
            var memberUserId = Guid.NewGuid();
            var systemAdminUserId = Guid.NewGuid();
            await TaskV1MigrationRawSqlSeed.AddUserAsync(testConnectionString, graph, memberUserId, "wpc02a-member");
            await TaskV1MigrationRawSqlSeed.AddUserAsync(testConnectionString, graph, systemAdminUserId, "wpc02a-system-admin");

            await PostgreSqlMigrationTestDatabase.MigrateAsync(testConnectionString);

            await using (var setup = PostgreSqlMigrationTestDatabase.CreatePlatformContext(testConnectionString))
            {
                setup.WorkspaceMembers.Add(new WorkspaceMember
                {
                    TenantId = graph.TenantId,
                    WorkspaceId = graph.WorkspaceId,
                    UserId = memberUserId,
                    Role = WorkspaceRole.Member,
                    Status = MembershipStatus.Active,
                    JoinedAt = new DateTimeOffset(2026, 8, 16, 0, 0, 0, TimeSpan.Zero)
                });
                await setup.SaveChangesAsync();
            }

            await PostgreSqlMigrationTestDatabase.ExecuteAsync(
                testConnectionString,
                """
                UPDATE workspaces
                SET "Status" = 'Archived'
                WHERE "Id" = @workspaceId;

                UPDATE users
                SET "SystemRole" = 'SystemAdmin'
                WHERE "Id" = @systemAdminUserId;

                UPDATE projects
                SET "Visibility" = 'WorkspaceVisible',
                    "ActivationState" = 'Activated',
                    "ActivatedAtUtc" = TIMESTAMPTZ '2026-08-16T00:00:00Z',
                    "ActivationVersion" = 1
                WHERE "Id" = @projectId;
                """,
                ("workspaceId", graph.WorkspaceId),
                ("systemAdminUserId", systemAdminUserId),
                ("projectId", graph.ProjectId));

            await using var context = PostgreSqlMigrationTestDatabase.CreatePlatformContext(testConnectionString);
            var repository = new ProjectRepository(context);

            var memberVisible = await repository.ListVisibleAsync(memberUserId);
            var systemAdminVisible = await repository.ListVisibleAsync(systemAdminUserId);
            var readers = await repository.ListCurrentReaderUserIdsAsync(graph.ProjectId);

            Assert.Contains(memberVisible, project => project.Id == graph.ProjectId);
            Assert.DoesNotContain(systemAdminVisible, project => project.Id == graph.ProjectId);
            Assert.Contains(memberUserId, readers);
            Assert.DoesNotContain(systemAdminUserId, readers);
        });
    }

    private sealed record LegacyProjection(
        string? Visibility,
        string ActivationState,
        DateTimeOffset? ActivatedAtUtc,
        int? ActivationVersion,
        string? SuspendedFromStatus,
        string? ArchivedFromStatus);
}
