using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;

namespace AipPortal.Tests.PostgreSql;

/// <summary>
/// Relational acceptance evidence for the Task v1 write boundary.  These tests
/// deliberately use independent Npgsql DbContexts; InMemory and SQLite cannot
/// establish the unique-index or optimistic-concurrency guarantees asserted here.
/// </summary>
[Collection("PostgreSqlTaskV1")]
public sealed class TaskV1PostgreSqlAcceptanceTests
{
    private const string ConnectionStringEnvironmentVariable = "POSTGRES_TEST_CONNECTION_STRING";

    [Fact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task ConcurrentTaskWritesPersistOnlyTheWinnerAndClearTheLoser()
    {
        var connectionString = Environment.GetEnvironmentVariable(ConnectionStringEnvironmentVariable);
        if (string.IsNullOrWhiteSpace(connectionString)) return;

        var graph = await SeedAsync(connectionString);
        await using var writerA = CreateContext(connectionString, graph.Tenant);
        await using var writerB = CreateContext(connectionString, graph.Tenant);
        var taskA = await writerA.TaskItems.SingleAsync(item => item.Id == graph.Task.Id);
        var taskB = await writerB.TaskItems.SingleAsync(item => item.Id == graph.Task.Id);

        QueueTaskMutation(writerA, taskA, graph.User.Id, "winner");
        QueueTaskMutation(writerB, taskB, graph.User.Id, "loser");

        Assert.Equal(TaskCommandSaveResult.Saved, await new EfUnitOfWork(writerA).SaveTaskCommandAsync());
        Assert.Equal(TaskCommandSaveResult.ConcurrencyConflict, await new EfUnitOfWork(writerB).SaveTaskCommandAsync());
        Assert.Empty(writerB.ChangeTracker.Entries());

        await using var verify = CreateContext(connectionString, graph.Tenant);
        var persisted = await verify.TaskItems.SingleAsync(item => item.Id == graph.Task.Id);
        Assert.Equal("winner", persisted.Title);
        Assert.Equal(2, persisted.VersionNo);
        Assert.Single(await verify.AuditLogs.Where(log => log.EntityId == graph.Task.Id).ToListAsync());
        Assert.Single(await verify.OutboxEvents.Where(evt => evt.AggregateId == graph.Task.Id).ToListAsync());

        // A cleared failed request can safely retry from the authoritative version.
        await using var retry = CreateContext(connectionString, graph.Tenant);
        var retryTask = await retry.TaskItems.SingleAsync(item => item.Id == graph.Task.Id);
        QueueTaskMutation(retry, retryTask, graph.User.Id, "retry");
        Assert.Equal(TaskCommandSaveResult.Saved, await new EfUnitOfWork(retry).SaveTaskCommandAsync());
        await using var final = CreateContext(connectionString, graph.Tenant);
        Assert.Equal("retry", (await final.TaskItems.SingleAsync(item => item.Id == graph.Task.Id)).Title);
        Assert.Equal(3, (await final.TaskItems.SingleAsync(item => item.Id == graph.Task.Id)).VersionNo);
        Assert.Equal(2, await final.AuditLogs.CountAsync(log => log.EntityId == graph.Task.Id));
        Assert.Equal(2, await final.OutboxEvents.CountAsync(evt => evt.AggregateId == graph.Task.Id));
    }

    [Fact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task ConcurrentTaskFileAssociationLeavesOneActiveLinkAndNoLosingSideEffects()
    {
        var connectionString = Environment.GetEnvironmentVariable(ConnectionStringEnvironmentVariable);
        if (string.IsNullOrWhiteSpace(connectionString)) return;

        var graph = await SeedAsync(connectionString, withFile: true);
        await using var writerA = CreateContext(connectionString, graph.Tenant);
        await using var writerB = CreateContext(connectionString, graph.Tenant);
        var taskA = await writerA.TaskItems.SingleAsync(item => item.Id == graph.Task.Id);
        var taskB = await writerB.TaskItems.SingleAsync(item => item.Id == graph.Task.Id);
        var fileId = graph.File!.Id;

        QueueTaskFileAssociation(writerA, taskA, graph, "winner");
        QueueTaskFileAssociation(writerB, taskB, graph, "loser");

        Assert.Equal(TaskCommandSaveResult.Saved, await new EfUnitOfWork(writerA).SaveTaskCommandAsync());
        Assert.Equal(TaskCommandSaveResult.UniqueConflict, await new EfUnitOfWork(writerB).SaveTaskCommandAsync());
        Assert.Empty(writerB.ChangeTracker.Entries());

        await using var verify = CreateContext(connectionString, graph.Tenant);
        Assert.Single(await verify.Attachments.Where(item => item.OwnerType == AttachmentOwnerType.TaskItem && item.OwnerId == graph.Task.Id && item.FileObjectId == fileId && item.DeletedAt == null).ToListAsync());
        Assert.Single(await verify.AuditLogs.Where(log => log.EntityId == graph.Task.Id && log.Action == "TaskFileAssociated").ToListAsync());
        Assert.Single(await verify.OutboxEvents.Where(evt => evt.AggregateId == graph.Task.Id && evt.EventType == "Projects.TaskChanged.v1").ToListAsync());
    }

    [Fact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task TenantFilterAndUniqueWatchAndLabelConstraintsAreEnforcedByPostgreSql()
    {
        var connectionString = Environment.GetEnvironmentVariable(ConnectionStringEnvironmentVariable);
        if (string.IsNullOrWhiteSpace(connectionString)) return;

        var graph = await SeedAsync(connectionString);
        await using var tenantContext = CreateContext(connectionString, graph.Tenant);
        tenantContext.WorkItemWatchStates.Add(new WorkItemWatchState { TaskItemId = graph.Task.Id, UserId = graph.User.Id, AutomaticSources = WorkItemWatchAutomaticSource.Creator, IsWatching = true, UpdatedAt = DateTimeOffset.UtcNow, VersionNo = 1 });
        tenantContext.ProjectTaskLabels.Add(new ProjectTaskLabel { WorkspaceId = graph.Workspace.Id, ProjectId = graph.Project.Id, Name = "Acceptance label", SortKey = 1024, VersionNo = 1 });
        await tenantContext.SaveChangesAsync();

        await using var duplicate = CreateContext(connectionString, graph.Tenant);
        duplicate.WorkItemWatchStates.Add(new WorkItemWatchState { TaskItemId = graph.Task.Id, UserId = graph.User.Id, AutomaticSources = WorkItemWatchAutomaticSource.Creator, IsWatching = true, UpdatedAt = DateTimeOffset.UtcNow, VersionNo = 1 });
        duplicate.ProjectTaskLabels.Add(new ProjectTaskLabel { WorkspaceId = graph.Workspace.Id, ProjectId = graph.Project.Id, Name = "Acceptance label", SortKey = 2048, VersionNo = 1 });
        Assert.Equal(TaskCommandSaveResult.UniqueConflict, await new EfUnitOfWork(duplicate).SaveTaskCommandAsync());
        Assert.Empty(duplicate.ChangeTracker.Entries());

        var otherTenant = new Tenant { Name = $"Other {Guid.NewGuid():N}", DisplayName = "Other", Slug = $"other-{Guid.NewGuid():N}" };
        await using (var platform = CreatePlatformContext(connectionString))
        {
            platform.Tenants.Add(otherTenant);
            await platform.SaveChangesAsync();
        }
        await using var otherContext = CreateContext(connectionString, otherTenant);
        Assert.Empty(await otherContext.TaskItems.Where(item => item.Id == graph.Task.Id).ToListAsync());
    }

    [Fact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task CleanAndUpgradeMigrationsPreserveLegacyTaskCommentsAndBackfillCreatorWatch()
    {
        var connectionString = Environment.GetEnvironmentVariable(ConnectionStringEnvironmentVariable);
        if (string.IsNullOrWhiteSpace(connectionString)) return;

        var databaseName = $"aip_taskv1_migration_{Guid.NewGuid():N}";
        var source = new NpgsqlConnectionStringBuilder(connectionString);
        var admin = new NpgsqlConnectionStringBuilder(connectionString) { Database = source.Database };
        var test = new NpgsqlConnectionStringBuilder(connectionString) { Database = databaseName }.ConnectionString;
        await using var adminConnection = new NpgsqlConnection(admin.ConnectionString);
        await adminConnection.OpenAsync();
        await using (var create = new NpgsqlCommand($"CREATE DATABASE \"{databaseName}\"", adminConnection))
        {
            await create.ExecuteNonQueryAsync();
        }

        try
        {
            var currentTenant = new CurrentTenantService();
            currentTenant.SetPlatformScope();
            await using (var upgrade = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(test).Options, currentTenant))
            {
                await upgrade.GetService<IMigrator>().MigrateAsync("20260719071017_MyTasksProjectionIndexes");
                var suffix = Guid.NewGuid().ToString("N");
                var tenant = new Tenant { Name = $"Migration {suffix}", DisplayName = "Migration", Slug = $"migration-{suffix}" };
                var user = new User { DisplayName = "Migration user", Email = $"migration-{suffix}@example.test", NormalizedEmail = $"MIGRATION-{suffix}@EXAMPLE.TEST", PasswordHash = "hash" };
                upgrade.Tenants.Add(tenant);
                upgrade.Users.Add(user);
                await upgrade.SaveChangesAsync();

                currentTenant.SetTenant(tenant.Id, tenant.Slug);
                var workspace = new Workspace { TenantId = tenant.Id, Name = "Migration workspace", Slug = $"migration-workspace-{suffix}", CreatedByUserId = user.Id };
                var project = new Project { TenantId = tenant.Id, WorkspaceId = workspace.Id, OwnerUserId = user.Id, CreatedByUserId = user.Id, Name = "Migration project", Slug = $"migration-project-{suffix}" };
                var task = new TaskItem { TenantId = tenant.Id, WorkspaceId = workspace.Id, ProjectId = project.Id, Title = "Migration task", CreatedByUserId = user.Id, VersionNo = 1 };
                var legacyComment = new Comment { TenantId = tenant.Id, WorkspaceId = workspace.Id, TargetType = CommentTargetType.TaskItem, TargetId = task.Id, AuthorUserId = user.Id, Body = "legacy plain text" };
                upgrade.Workspaces.Add(workspace);
                upgrade.Projects.Add(project);
                upgrade.TaskItems.Add(task);
                upgrade.Comments.Add(legacyComment);
                await upgrade.SaveChangesAsync();

                await upgrade.GetService<IMigrator>().MigrateAsync();
                Assert.Equal("legacy plain text", await upgrade.TaskComments.Where(comment => comment.Id == legacyComment.Id).Select(comment => comment.BodyPlainText).SingleAsync());
                var watch = await upgrade.WorkItemWatchStates.SingleAsync(state => state.TaskItemId == task.Id && state.UserId == user.Id);
                Assert.True(watch.IsWatching);
                Assert.True(watch.AutomaticSources.HasFlag(WorkItemWatchAutomaticSource.Creator));
                Assert.Equal(1, watch.VersionNo);
            }

            var cleanTenant = new CurrentTenantService();
            cleanTenant.SetPlatformScope();
            await using var clean = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(test).Options, cleanTenant);
            Assert.Empty(await clean.Database.GetPendingMigrationsAsync());
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await using var drop = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{databaseName}\" WITH (FORCE)", adminConnection);
            await drop.ExecuteNonQueryAsync();
        }
    }

    private static AppDbContext CreateContext(string connectionString, Tenant tenant)
    {
        var currentTenant = new CurrentTenantService();
        currentTenant.SetTenant(tenant.Id, tenant.Slug);
        return new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(connectionString).Options, currentTenant);
    }

    private static AppDbContext CreatePlatformContext(string connectionString)
    {
        var currentTenant = new CurrentTenantService();
        currentTenant.SetPlatformScope();
        return new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(connectionString).Options, currentTenant);
    }

    private static async Task<Graph> SeedAsync(string connectionString, bool withFile = false)
    {
        var suffix = Guid.NewGuid().ToString("N");
        await using var context = CreatePlatformContext(connectionString);
        var tenant = new Tenant { Name = $"Task acceptance {suffix}", DisplayName = "Task acceptance", Slug = $"task-acceptance-{suffix}" };
        var user = new User { DisplayName = "Task acceptance user", Email = $"task-{suffix}@example.test", NormalizedEmail = $"TASK-{suffix}@EXAMPLE.TEST", PasswordHash = "hash", Status = UserStatus.Active };
        context.Tenants.Add(tenant);
        context.Users.Add(user);
        await context.SaveChangesAsync();

        var currentTenant = new CurrentTenantService();
        currentTenant.SetTenant(tenant.Id, tenant.Slug);
        await using var tenantContext = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(connectionString).Options, currentTenant);
        var workspace = new Workspace { TenantId = tenant.Id, Name = "Task acceptance workspace", Slug = $"task-acceptance-ws-{suffix}", CreatedByUserId = user.Id };
        var project = new Project { TenantId = tenant.Id, WorkspaceId = workspace.Id, OwnerUserId = user.Id, CreatedByUserId = user.Id, Name = "Task acceptance project", Slug = $"task-acceptance-project-{suffix}" };
        var task = new TaskItem { TenantId = tenant.Id, WorkspaceId = workspace.Id, ProjectId = project.Id, Title = "original", CreatedByUserId = user.Id, Priority = TaskPriority.Medium, VersionNo = 1 };
        tenantContext.Workspaces.Add(workspace);
        tenantContext.WorkspaceMembers.Add(new WorkspaceMember { TenantId = tenant.Id, WorkspaceId = workspace.Id, UserId = user.Id, Role = WorkspaceRole.Owner, Status = MembershipStatus.Active, JoinedAt = DateTimeOffset.UtcNow });
        tenantContext.TenantUsers.Add(new TenantUser { TenantId = tenant.Id, UserId = user.Id, Role = TenantUserRole.Member, Status = TenantUserStatus.Active, JoinedAt = DateTimeOffset.UtcNow });
        tenantContext.Projects.Add(project);
        tenantContext.ProjectMembers.Add(new ProjectMember { TenantId = tenant.Id, ProjectId = project.Id, UserId = user.Id, Role = ProjectRole.Owner, JoinedAt = DateTimeOffset.UtcNow });
        tenantContext.TaskItems.Add(task);
        FileObject? file = null;
        if (withFile)
        {
            file = new FileObject { TenantId = tenant.Id, WorkspaceId = workspace.Id, ProjectId = project.Id, UploadedByUserId = user.Id, OriginalFileName = "acceptance.txt", StorageKey = $"acceptance/{suffix}", ContentType = "text/plain", SizeBytes = 1, Status = FileObjectStatus.Active };
            tenantContext.FileObjects.Add(file);
        }
        await tenantContext.SaveChangesAsync();
        return new Graph(tenant, workspace, project, task, user, file);
    }

    private static void QueueTaskMutation(AppDbContext context, TaskItem task, Guid actorId, string title)
    {
        task.Title = title;
        task.VersionNo++;
        QueueSideEffects(context, task, actorId, title);
    }

    private static void QueueTaskFileAssociation(AppDbContext context, TaskItem task, Graph graph, string marker)
    {
        task.VersionNo++;
        context.Attachments.Add(new Attachment
        {
            TenantId = graph.Tenant.Id, FileObjectId = graph.File!.Id, WorkspaceId = graph.Workspace.Id,
            OwnerType = AttachmentOwnerType.TaskItem, OwnerId = graph.Task.Id, OwnerUserId = graph.User.Id,
            UploadedByUserId = graph.User.Id, FileName = "acceptance.txt", StoredFileName = "acceptance.txt",
            FilePath = "acceptance.txt", ContentType = "text/plain", Extension = ".txt", SizeBytes = 1,
            StorageProvider = "test", StorageKey = $"acceptance/{marker}", ScanStatus = FileScanStatus.Clean
        });
        QueueSideEffects(context, task, graph.User.Id, marker, "TaskFileAssociated");
    }

    private static void QueueSideEffects(AppDbContext context, TaskItem task, Guid actorId, string marker, string action = "TaskUpdated")
    {
        context.AuditLogs.Add(new AuditLog { TenantId = task.TenantId, ActorUserId = actorId, Action = action, EntityType = "TaskItem", EntityId = task.Id, WorkspaceId = task.WorkspaceId, ProjectId = task.ProjectId, Summary = marker, CreatedAt = DateTimeOffset.UtcNow });
        context.OutboxEvents.Add(new OutboxEvent(Guid.NewGuid()) { TenantId = task.TenantId, EventType = "Projects.TaskChanged.v1", PayloadSchemaVersion = 1, AggregateType = "Task", AggregateId = task.Id, AggregateVersion = task.VersionNo, OccurredAt = DateTimeOffset.UtcNow, PayloadJson = "{}", RoutingJson = "[]", Status = OutboxEventStatus.Pending, NextAttemptAt = DateTimeOffset.UtcNow });
    }

    private sealed record Graph(Tenant Tenant, Workspace Workspace, Project Project, TaskItem Task, User User, FileObject? File);
}

[CollectionDefinition("PostgreSqlTaskV1", DisableParallelization = true)]
public sealed class PostgreSqlTaskV1Collection;
