using AipPortal.Application.Common.Tenancy;
using AipPortal.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;

namespace AipPortal.Tests.PostgreSql;

/// <summary>Fresh-database migration contract checks. Upgrade scenarios use raw SQL only and live beside this suite.</summary>
[Collection("PostgreSqlTaskV1")]
public sealed class TaskV1MigrationPostgreSqlTests
{
    [Fact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task CleanDatabaseMigratesToLatestWithTaskV1DatabaseContracts()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
        await WithTemporaryDatabaseAsync(connectionString, async testConnectionString =>
        {
            await using var context = CreatePlatformContext(testConnectionString);
            await context.GetService<IMigrator>().MigrateAsync();

            Assert.Empty(await context.Database.GetPendingMigrationsAsync());
            Assert.False(context.Database.HasPendingModelChanges());
            Assert.True(await ScalarAsync<bool>(testConnectionString, "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workspaces' AND column_name = 'TimeZone');"));
            Assert.True(await ScalarAsync<bool>(testConnectionString, "SELECT EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_class c ON c.oid = d.adrelid JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.adnum WHERE c.relname = 'work_item_watch_states' AND a.attname = 'VersionNo' AND pg_get_expr(d.adbin, d.adrelid) = '1');"));
            Assert.True(await ScalarAsync<bool>(testConnectionString, "SELECT EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_class c ON c.oid = d.adrelid JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.adnum WHERE c.relname = 'project_task_labels' AND a.attname = 'VersionNo' AND pg_get_expr(d.adbin, d.adrelid) = '1');"));
            Assert.True(await ScalarAsync<bool>(testConnectionString, "SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'attachments' AND indexname = 'IX_attachments_OwnerType_OwnerId_FileObjectId_active_task');"));
            Assert.True(await ScalarAsync<bool>(testConnectionString, "SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'project_task_labels' AND indexname = 'IX_project_task_labels_TenantId_ProjectId_NormalizedName');"));
        });
    }

    private static AppDbContext CreatePlatformContext(string connectionString)
    {
        var tenant = new CurrentTenantService();
        tenant.SetPlatformScope();
        return new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(connectionString).Options, tenant);
    }

    private static async Task<T> ScalarAsync<T>(string connectionString, string sql)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        return (T)(await command.ExecuteScalarAsync())!;
    }

    private static async Task WithTemporaryDatabaseAsync(string connectionString, Func<string, Task> action)
    {
        var name = $"aip_taskv1_migration_{Guid.NewGuid():N}";
        var source = new NpgsqlConnectionStringBuilder(connectionString);
        var admin = new NpgsqlConnectionStringBuilder(connectionString) { Database = source.Database };
        var test = new NpgsqlConnectionStringBuilder(connectionString) { Database = name }.ConnectionString;
        await using var connection = new NpgsqlConnection(admin.ConnectionString);
        await connection.OpenAsync();
        await using (var create = new NpgsqlCommand($"CREATE DATABASE \"{name}\"", connection)) await create.ExecuteNonQueryAsync();
        try { await action(test); }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await using var drop = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{name}\" WITH (FORCE)", connection);
            await drop.ExecuteNonQueryAsync();
        }
    }
}
