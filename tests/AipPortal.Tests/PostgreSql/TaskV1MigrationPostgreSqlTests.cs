using AipPortal.Application.Common.Tenancy;
using AipPortal.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;

namespace AipPortal.Tests.PostgreSql;

/// <summary>Fresh-database migration contract checks. Upgrade scenarios use raw SQL only and live beside this suite.</summary>
[Collection("PostgreSqlTaskV1")]
[Trait("Scope", "TaskV1Prompt2C")]
public sealed class TaskV1MigrationPostgreSqlTests
{
    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    [Trait("Scope", "TaskV1PR03C")]
    public async Task CleanDatabaseMigratesToLatestWithTaskV1DatabaseContracts()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
        await WithTemporaryDatabaseAsync(connectionString, async testConnectionString =>
        {
            await using var context = PostgreSqlMigrationTestDatabase.CreatePlatformContext(testConnectionString);
            await context.GetService<IMigrator>().MigrateAsync();

            Assert.Empty(await context.Database.GetPendingMigrationsAsync());
            Assert.False(context.Database.HasPendingModelChanges());
            Assert.True(await ScalarAsync<bool>(testConnectionString, "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workspaces' AND column_name = 'TimeZone');"));
            Assert.True(await ScalarAsync<bool>(testConnectionString, "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'work_item_watch_states' AND column_name = 'IsManualWatch');"));
            Assert.True(await ScalarAsync<bool>(testConnectionString, "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CK_work_item_watch_states_manual_opt_out_exclusive');"));
            Assert.True(await ScalarAsync<bool>(testConnectionString, "SELECT EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_class c ON c.oid = d.adrelid JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.adnum WHERE c.relname = 'work_item_watch_states' AND a.attname = 'VersionNo' AND pg_get_expr(d.adbin, d.adrelid) = '1');"));
            Assert.True(await ScalarAsync<bool>(testConnectionString, "SELECT EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_class c ON c.oid = d.adrelid JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.adnum WHERE c.relname = 'project_task_labels' AND a.attname = 'VersionNo' AND pg_get_expr(d.adbin, d.adrelid) = '1');"));
            Assert.True(await ScalarAsync<bool>(testConnectionString, "SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'attachments' AND indexname = 'IX_attachments_OwnerType_OwnerId_FileObjectId_active_task');"));
            Assert.True(await ScalarAsync<bool>(testConnectionString, "SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'project_task_labels' AND indexname = 'IX_project_task_labels_TenantId_ProjectId_NormalizedName');"));
            Assert.True(await ScalarAsync<bool>(testConnectionString, "SELECT EXISTS (SELECT 1 FROM pg_attribute attribute JOIN pg_class table_class ON table_class.oid = attribute.attrelid WHERE table_class.relname = 'project_task_labels' AND attribute.attname = 'NormalizedName' AND attribute.attgenerated = 's');"));
            Assert.True(context.Model.FindEntityType(typeof(AipPortal.Domain.Entities.WorkItemWatchState))!.FindProperty(nameof(AipPortal.Domain.Entities.WorkItemWatchState.VersionNo))!.IsConcurrencyToken);
            Assert.NotNull(context.Model.FindEntityType(typeof(AipPortal.Domain.Entities.WorkItemWatchState))!.FindProperty(nameof(AipPortal.Domain.Entities.WorkItemWatchState.IsManualWatch)));
            Assert.True(context.Model.FindEntityType(typeof(AipPortal.Domain.Entities.ProjectTaskLabel))!.FindProperty(nameof(AipPortal.Domain.Entities.ProjectTaskLabel.VersionNo))!.IsConcurrencyToken);
        });
    }

    private static async Task<T> ScalarAsync<T>(string connectionString, string sql)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        return (T)(await command.ExecuteScalarAsync())!;
    }

    private static Task WithTemporaryDatabaseAsync(string connectionString, Func<string, Task> action)
        => PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, action);
}
