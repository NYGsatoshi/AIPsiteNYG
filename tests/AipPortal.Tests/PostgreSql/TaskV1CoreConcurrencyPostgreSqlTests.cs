using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Application.Files;
using AipPortal.Application.Messaging;
using AipPortal.Application.Projects;
using AipPortal.Application.Realtime;
using AipPortal.Application.Workspaces;
using AipPortal.Application.Groups;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Audit;
using AipPortal.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace AipPortal.Tests.PostgreSql;

/// <summary>
/// Exercises the versioned Task command boundary with two independent request
/// scopes.  The scopes share only a deterministic clock coordinator; each owns
/// its DbContext, repositories, authorization services, audit logger, outbox,
/// and EfUnitOfWork.
/// </summary>
[Collection("PostgreSqlTaskV1")]
public sealed class TaskV1CoreConcurrencyPostgreSqlTests
{
    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task UpdateDetails_OneServiceWriterWins_LoserIsCleanAndCanRetry()
    {
        await using var harness = await ServiceHarness.CreateAsync();
        var expected = harness.Graph.Task.VersionNo;
        await using var first = harness.CreateScope();
        await using var second = harness.CreateScope();

        // Both requests read the same authoritative version before their writes.
        Assert.Equal(expected, (await first.Commands.GetAsync(harness.Graph.Task.Id)).Value!.Version);
        Assert.Equal(expected, (await second.Commands.GetAsync(harness.Graph.Task.Id)).Value!.Version);

        harness.Race.Arm();
        var results = await Task.WhenAll(
            Task.Run(() => first.Commands.UpdateDetailsAsync(harness.Graph.Task.Id, Details("first", expected))),
            Task.Run(() => second.Commands.UpdateDetailsAsync(harness.Graph.Task.Id, Details("second", expected))));

        Assert.Equal(1, results.Count(result => result.IsSuccess));
        var winner = results.Single(result => result.IsSuccess);
        var loser = results.Single(result => !result.IsSuccess);
        Assert.Equal("TASK_STALE_VERSION", Code(loser.Error));
        Assert.Empty((ReferenceEquals(loser, results[0]) ? first : second).Db.ChangeTracker.Entries());

        await using (var verify = harness.CreateScope())
        {
            var task = await verify.Db.TaskItems.SingleAsync(item => item.Id == harness.Graph.Task.Id);
            Assert.Equal(winner.Value!.Title, task.Title);
            Assert.Equal(2, task.VersionNo);
            Assert.Single(await verify.Db.AuditLogs.Where(log => log.EntityId == task.Id && log.Action == "TaskUpdated").ToListAsync());
            Assert.Single(await verify.Db.OutboxEvents.Where(evt => evt.AggregateId == task.Id && evt.EventType == "Projects.TaskChanged.v1").ToListAsync());
            Assert.Equal("unrelated", await verify.Db.TaskItems.Where(item => item.Id == harness.Graph.UnrelatedTask.Id).Select(item => item.Title).SingleAsync());
        }

        await using var retry = harness.CreateScope();
        var current = (await retry.Commands.GetAsync(harness.Graph.Task.Id)).Value!;
        var retried = await retry.Commands.UpdateDetailsAsync(harness.Graph.Task.Id, Details("retry", current.Version));
        Assert.True(retried.IsSuccess);
        Assert.Equal("retry", retried.Value!.Title);
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task CreateSubtask_ParentConflictRollsBackLoserChildWatchAuditAndOutbox()
    {
        await using var harness = await ServiceHarness.CreateAsync();
        await using var first = harness.CreateScope();
        await using var second = harness.CreateScope();

        harness.Race.Arm();
        var results = await Task.WhenAll(
            Task.Run(() => first.Subresources.CreateSubtaskAsync(harness.Graph.Task.Id, new CreateTaskSubtaskRequest("first child", null, TaskPriority.Medium))),
            Task.Run(() => second.Subresources.CreateSubtaskAsync(harness.Graph.Task.Id, new CreateTaskSubtaskRequest("second child", null, TaskPriority.Medium))));

        Assert.Equal(1, results.Count(result => result.IsSuccess));
        var winner = results.Single(result => result.IsSuccess);
        var loser = results.Single(result => !result.IsSuccess);
        Assert.Equal("TASK_STALE_VERSION", Code(loser.Error));
        Assert.Empty((ReferenceEquals(loser, results[0]) ? first : second).Db.ChangeTracker.Entries());

        await using (var verify = harness.CreateScope())
        {
            var children = await verify.Db.TaskItems.Where(item => item.ParentTaskItemId == harness.Graph.Task.Id).ToListAsync();
            var child = Assert.Single(children);
            Assert.Equal(winner.Value!.Title, child.Title);
            Assert.Single(await verify.Db.WorkItemWatchStates.Where(state => state.TaskItemId == child.Id && state.UserId == harness.Graph.User.Id && state.AutomaticSources == WorkItemWatchAutomaticSource.Creator).ToListAsync());
            Assert.Equal(2, (await verify.Db.TaskItems.SingleAsync(item => item.Id == harness.Graph.Task.Id)).VersionNo);
            Assert.Single(await verify.Db.AuditLogs.Where(log => log.EntityId == child.Id && log.Action == "TaskCreated").ToListAsync());
            Assert.Single(await verify.Db.AuditLogs.Where(log => log.EntityId == harness.Graph.Task.Id && log.Action == "TaskSubtasksChanged").ToListAsync());
            Assert.Single(await verify.Db.OutboxEvents.Where(evt => evt.AggregateId == child.Id).ToListAsync());
            Assert.Single(await verify.Db.OutboxEvents.Where(evt => evt.AggregateId == harness.Graph.Task.Id).ToListAsync());
        }

        await using var retry = harness.CreateScope();
        var retried = await retry.Subresources.CreateSubtaskAsync(harness.Graph.Task.Id, new CreateTaskSubtaskRequest("retry child", null, TaskPriority.Medium));
        Assert.True(retried.IsSuccess);
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task Checklist_CreateUpdateDeleteAndReorder_AreAggregateAtomic()
    {
        await using var harness = await ServiceHarness.CreateAsync();
        var firstItem = await CreateChecklistAsync(harness, "first");
        var secondItem = await CreateChecklistAsync(harness, "second");

        await using (var createA = harness.CreateScope())
        await using (var createB = harness.CreateScope())
        {
            harness.Race.Arm();
            var creates = await Task.WhenAll(
                Task.Run(() => createA.Subresources.CreateChecklistAsync(harness.Graph.Task.Id, new CreateTaskChecklistRequest("racing a"))),
                Task.Run(() => createB.Subresources.CreateChecklistAsync(harness.Graph.Task.Id, new CreateTaskChecklistRequest("racing b"))));
            Assert.Equal(1, creates.Count(result => result.IsSuccess));
            Assert.Equal("TASK_STALE_VERSION", Code(creates.Single(result => !result.IsSuccess).Error));
        }

        await using (var updateA = harness.CreateScope())
        await using (var updateB = harness.CreateScope())
        {
            harness.Race.Arm();
            var updates = await Task.WhenAll(
                Task.Run(() => updateA.Subresources.UpdateChecklistAsync(harness.Graph.Task.Id, firstItem.Id, new UpdateTaskChecklistRequest("completed", true, firstItem.Version))),
                Task.Run(() => updateB.Subresources.UpdateChecklistAsync(harness.Graph.Task.Id, firstItem.Id, new UpdateTaskChecklistRequest("other", false, firstItem.Version))));
            Assert.Equal(1, updates.Count(result => result.IsSuccess));
            var winner = updates.Single(result => result.IsSuccess).Value!;
            Assert.Equal("TASK_STALE_VERSION", Code(updates.Single(result => !result.IsSuccess).Error));
            await using var verify = harness.CreateScope();
            var item = await verify.Db.TaskChecklistItems.SingleAsync(value => value.Id == firstItem.Id);
            Assert.Equal(winner.Text, item.Text);
            Assert.Equal(winner.IsCompleted, item.IsCompleted);
            Assert.Equal(winner.IsCompleted ? harness.Graph.User.Id : null, item.CompletedByUserId);
            Assert.Equal(winner.IsCompleted, item.CompletedAt.HasValue);
            Assert.Equal(2, item.VersionNo);
        }

        await using (var reorderA = harness.CreateScope())
        await using (var reorderB = harness.CreateScope())
        {
            var current = await ChecklistAsync(harness);
            var ids = current.Items.Select(item => item.Id).ToArray();
            harness.Race.Arm();
            var reorders = await Task.WhenAll(
                Task.Run(() => reorderA.Subresources.ReorderChecklistAsync(harness.Graph.Task.Id, new ReorderTaskChecklistRequest(ids.Reverse().ToArray(), current.TaskVersion))),
                Task.Run(() => reorderB.Subresources.ReorderChecklistAsync(harness.Graph.Task.Id, new ReorderTaskChecklistRequest(ids, current.TaskVersion))));
            Assert.Equal(1, reorders.Count(result => result.IsSuccess));
            var winner = reorders.Single(result => result.IsSuccess).Value!;
            Assert.Equal("TASK_STALE_VERSION", Code(reorders.Single(result => !result.IsSuccess).Error));
            Assert.Equal(winner.Items.Select(item => item.Id), (await ChecklistAsync(harness)).Items.Select(item => item.Id));
        }

        await using (var delete = harness.CreateScope())
        {
            var current = await delete.Subresources.ListChecklistAsync(harness.Graph.Task.Id);
            var item = current.Value!.Single(value => value.Id == secondItem.Id);
            Assert.True((await delete.Subresources.DeleteChecklistAsync(harness.Graph.Task.Id, item.Id, item.Version)).IsSuccess);
        }

        await using var final = harness.CreateScope();
        Assert.DoesNotContain(await final.Db.TaskChecklistItems.ToListAsync(), item => item.Id == secondItem.Id);
        Assert.Equal(await final.Db.AuditLogs.CountAsync(log => log.Action.StartsWith("TaskChecklist", StringComparison.Ordinal)), await final.Db.OutboxEvents.CountAsync(evt => evt.EventType == "Projects.TaskChanged.v1"));
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task ChildDetailMutation_ParentVersionAuditAndOutboxCommitOrRollbackTogether()
    {
        await using var harness = await ServiceHarness.CreateAsync();
        await using var creator = harness.CreateScope();
        var created = await creator.Subresources.CreateSubtaskAsync(harness.Graph.Task.Id, new CreateTaskSubtaskRequest("child", null, TaskPriority.Medium));
        Assert.True(created.IsSuccess);
        var child = created.Value!;

        await using var first = harness.CreateScope();
        await using var second = harness.CreateScope();
        harness.Race.Arm();
        var results = await Task.WhenAll(
            Task.Run(() => first.Commands.UpdateDetailsAsync(child.Id, new TaskUpdateDetailsRequest(null, null, null, new DateOnly(2026, 7, 27), new DateOnly(2026, 7, 28), 25, child.Version))),
            Task.Run(() => second.Commands.UpdateDetailsAsync(child.Id, new TaskUpdateDetailsRequest(null, null, null, new DateOnly(2026, 7, 29), new DateOnly(2026, 7, 30), 75, child.Version))));

        Assert.Equal(1, results.Count(result => result.IsSuccess));
        Assert.Equal("TASK_STALE_VERSION", Code(results.Single(result => !result.IsSuccess).Error));

        await using var verify = harness.CreateScope();
        var persistedChild = await verify.Db.TaskItems.SingleAsync(item => item.Id == child.Id);
        var persistedParent = await verify.Db.TaskItems.SingleAsync(item => item.Id == harness.Graph.Task.Id);
        Assert.Equal(2, persistedChild.VersionNo);
        Assert.Equal(3, persistedParent.VersionNo);
        Assert.Equal(2, await verify.Db.AuditLogs.CountAsync(log => log.EntityId == child.Id));
        Assert.Equal(2, await verify.Db.AuditLogs.CountAsync(log => log.EntityId == persistedParent.Id && log.Action == "TaskSubtasksChanged"));
        Assert.Equal(2, await verify.Db.OutboxEvents.CountAsync(evt => evt.AggregateId == child.Id));
        Assert.Equal(2, await verify.Db.OutboxEvents.CountAsync(evt => evt.AggregateId == persistedParent.Id));
        var detail = (await verify.Commands.GetAsync(persistedParent.Id)).Value!;
        Assert.Equal(persistedChild.ProgressPercent, detail.ProgressPercent);
        Assert.Equal(persistedChild.PlannedStartDate, detail.PlannedStartDate);
        Assert.Equal(persistedChild.PlannedEndDate, detail.PlannedEndDate);
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task Comment_UpdateDeleteAndLegacyAdapterRemainAtomicAndPrivate()
    {
        await using var harness = await ServiceHarness.CreateAsync();
        var created = await CreateCommentAsync(harness, "sensitive @mention text");

        await using (var update = harness.CreateScope())
        await using (var delete = harness.CreateScope())
        {
            harness.Race.Arm();
            var results = await Task.WhenAll(
                Task.Run(async () => { var result = await update.Subresources.UpdateCommentAsync(created.Id, new UpdateTaskCommentRequest("winner body", null, created.Version)); return (result.IsSuccess, result.Error); }),
                Task.Run(async () => { var result = await delete.Subresources.DeleteCommentAsync(created.Id, created.Version); return (result.IsSuccess, result.Error); }));
            Assert.Equal(1, results.Count(result => result.IsSuccess));
            Assert.Equal("TASK_STALE_VERSION", Code(results.Single(result => !result.IsSuccess).Error));
        }

        await using (var verify = harness.CreateScope())
        {
            var row = await verify.Db.TaskComments.SingleAsync(comment => comment.Id == created.Id);
            Assert.True(row.DeletedAt.HasValue || row.BodyPlainText == "winner body");
            Assert.Equal(2, row.VersionNo);
            var audit = await verify.Db.AuditLogs.Where(log => log.EntityId == harness.Graph.Task.Id && log.Action.StartsWith("TaskComment", StringComparison.Ordinal)).ToListAsync();
            Assert.All(audit, log => Assert.DoesNotContain("sensitive", $"{log.Summary} {log.MetadataJson}", StringComparison.OrdinalIgnoreCase));
        }

        // The compatibility read returns the canonical row; it never materializes a generic Comment.
        await using var compatibility = harness.CreateScope();
        var canonical = await compatibility.Subresources.GetCommentForCompatibilityAsync(created.Id);
        Assert.True(canonical.IsSuccess);
        Assert.Equal(0, await compatibility.Db.Comments.CountAsync(comment => comment.TargetType == CommentTargetType.TaskItem && comment.TargetId == harness.Graph.Task.Id));
    }

    private static TaskUpdateDetailsRequest Details(string title, long expectedVersion) => new(title, null, null, null, null, null, expectedVersion);

    private static string? Code(string? error) => error?.Split('|', 2)[0];

    private static async Task<TaskChecklistResponse> CreateChecklistAsync(ServiceHarness harness, string text)
    {
        await using var scope = harness.CreateScope();
        var result = await scope.Subresources.CreateChecklistAsync(harness.Graph.Task.Id, new CreateTaskChecklistRequest(text));
        Assert.True(result.IsSuccess);
        return result.Value!;
    }

    private static async Task<TaskCommentResponse> CreateCommentAsync(ServiceHarness harness, string text)
    {
        await using var scope = harness.CreateScope();
        var result = await scope.Subresources.CreateCommentAsync(harness.Graph.Task.Id, new CreateTaskCommentRequest(text));
        Assert.True(result.IsSuccess);
        return result.Value!;
    }

    private static async Task<(IReadOnlyList<TaskChecklistResponse> Items, long TaskVersion)> ChecklistAsync(ServiceHarness harness)
    {
        await using var scope = harness.CreateScope();
        var checklist = await scope.Subresources.ListChecklistAsync(harness.Graph.Task.Id);
        var task = (await scope.Commands.GetAsync(harness.Graph.Task.Id)).Value!;
        return (checklist.Value!, task.Version);
    }

    private sealed class ServiceHarness : IAsyncDisposable
    {
        private readonly ServiceProvider provider;
        private readonly string connectionString;

        private ServiceHarness(ServiceProvider provider, string connectionString, Graph graph, RaceClockCoordinator race)
        {
            this.provider = provider;
            this.connectionString = connectionString;
            Graph = graph;
            Race = race;
        }

        public Graph Graph { get; }
        public RaceClockCoordinator Race { get; }

        public static async Task<ServiceHarness> CreateAsync()
        {
            var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
            var graph = await SeedAsync(connectionString);
            var race = new RaceClockCoordinator();
            var services = new ServiceCollection();
            services.AddDbContext<AppDbContext>(options => options.UseNpgsql(connectionString));
            services.AddScoped<CurrentTenantService>();
            services.AddScoped<ICurrentTenant>(serviceProvider => serviceProvider.GetRequiredService<CurrentTenantService>());
            services.AddScoped<ICurrentUser>(_ => new TestCurrentUser(graph.User.Id));
            services.AddScoped<IClock>(_ => new CoordinatedClock(race));
            services.AddScoped<IProjectRepository, ProjectRepository>();
            services.AddScoped<IUserRepository, UserRepository>();
            services.AddScoped<IWorkspaceRepository, WorkspaceRepository>();
            services.AddScoped<IGroupRepository, GroupRepository>();
            services.AddScoped<IFileRepository, FileRepository>();
            services.AddScoped<IFileAuthorizationService, DenyingFileAuthorizationService>();
            services.AddScoped<IOutboxEventRepository, OutboxEventRepository>();
            services.AddScoped<ITransactionalOutbox, TransactionalOutbox>();
            services.AddScoped<IBusinessInvalidationPublisher, BusinessInvalidationPublisher>();
            services.AddScoped<IAuditLogger, DbAuditLogger>();
            services.AddScoped<EfUnitOfWork>();
            services.AddScoped<IUnitOfWork>(serviceProvider => serviceProvider.GetRequiredService<EfUnitOfWork>());
            services.AddScoped<ITaskCommandUnitOfWork>(serviceProvider => serviceProvider.GetRequiredService<EfUnitOfWork>());
            services.AddScoped<IWorkspaceAuthorizationService, WorkspaceAuthorizationService>();
            services.AddScoped<IGroupAuthorizationService, GroupAuthorizationService>();
            services.AddScoped<ProjectAuthorizationService>();
            services.AddScoped<IProjectAuthorizationService>(serviceProvider => serviceProvider.GetRequiredService<ProjectAuthorizationService>());
            services.AddScoped<ITaskAuthorizationService>(serviceProvider => serviceProvider.GetRequiredService<ProjectAuthorizationService>());
            services.AddScoped<ICommentAuthorizationService>(serviceProvider => serviceProvider.GetRequiredService<ProjectAuthorizationService>());
            services.AddSingleton(new CommunicationSafetyOptions());
            services.AddSingleton<ICommunicationSafetyGuard, InMemoryCommunicationSafetyGuard>();
            services.AddScoped<ITaskWorkspaceTimeZoneResolver, UtcTimeZoneResolver>();
            services.AddScoped<ITaskCommandService, TaskCommandService>();
            services.AddScoped<ITaskSubresourceService, TaskSubresourceService>();
            return new ServiceHarness(services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true }), connectionString, graph, race);
        }

        public RequestScope CreateScope()
        {
            var scope = provider.CreateAsyncScope();
            scope.ServiceProvider.GetRequiredService<CurrentTenantService>().SetTenant(Graph.Tenant.Id, Graph.Tenant.Slug);
            return new RequestScope(scope, scope.ServiceProvider.GetRequiredService<AppDbContext>(), scope.ServiceProvider.GetRequiredService<ITaskCommandService>(), scope.ServiceProvider.GetRequiredService<ITaskSubresourceService>());
        }

        public ValueTask DisposeAsync() => provider.DisposeAsync();

        private static async Task<Graph> SeedAsync(string connectionString)
        {
            var suffix = Guid.NewGuid().ToString("N");
            await using var platform = CreatePlatformContext(connectionString);
            var tenant = new Tenant { Name = $"Task concurrency {suffix}", DisplayName = "Task concurrency", Slug = $"task-concurrency-{suffix}" };
            var user = new User { DisplayName = "Task concurrency user", Email = $"task-concurrency-{suffix}@example.test", NormalizedEmail = $"TASK-CONCURRENCY-{suffix}@EXAMPLE.TEST", PasswordHash = "hash", Status = UserStatus.Active };
            platform.AddRange(tenant, user);
            await platform.SaveChangesAsync();

            var currentTenant = new CurrentTenantService();
            currentTenant.SetTenant(tenant.Id, tenant.Slug);
            await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(connectionString).Options, currentTenant);
            var workspace = new Workspace { TenantId = tenant.Id, Name = "Task concurrency workspace", Slug = $"task-concurrency-ws-{suffix}", CreatedByUserId = user.Id };
            var project = new Project { TenantId = tenant.Id, WorkspaceId = workspace.Id, OwnerUserId = user.Id, CreatedByUserId = user.Id, Name = "Task concurrency project", Slug = $"task-concurrency-project-{suffix}" };
            var task = new TaskItem { TenantId = tenant.Id, WorkspaceId = workspace.Id, ProjectId = project.Id, Title = "original", CreatedByUserId = user.Id, VersionNo = 1 };
            var unrelated = new TaskItem { TenantId = tenant.Id, WorkspaceId = workspace.Id, ProjectId = project.Id, Title = "unrelated", CreatedByUserId = user.Id, VersionNo = 1 };
            db.AddRange(workspace, project, task, unrelated,
                new TenantUser { TenantId = tenant.Id, UserId = user.Id, Role = TenantUserRole.Member, Status = TenantUserStatus.Active, JoinedAt = DateTimeOffset.UtcNow },
                new WorkspaceMember { TenantId = tenant.Id, WorkspaceId = workspace.Id, UserId = user.Id, Role = WorkspaceRole.Owner, Status = MembershipStatus.Active, JoinedAt = DateTimeOffset.UtcNow },
                new ProjectMember { TenantId = tenant.Id, ProjectId = project.Id, UserId = user.Id, Role = ProjectRole.Owner, JoinedAt = DateTimeOffset.UtcNow },
                TaskWatchStateInitializer.ForCreator(task, user.Id, new DateTimeOffset(2026, 7, 26, 0, 0, 0, TimeSpan.Zero)));
            await db.SaveChangesAsync();
            return new Graph(tenant, user, task, unrelated);
        }

        private static AppDbContext CreatePlatformContext(string connectionString)
        {
            var tenant = new CurrentTenantService();
            tenant.SetPlatformScope();
            return new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(connectionString).Options, tenant);
        }
    }

    private sealed record Graph(Tenant Tenant, User User, TaskItem Task, TaskItem UnrelatedTask);

    private sealed record RequestScope(AsyncServiceScope Scope, AppDbContext Db, ITaskCommandService Commands, ITaskSubresourceService Subresources) : IAsyncDisposable
    {
        public ValueTask DisposeAsync() => Scope.DisposeAsync();
    }

    private sealed class TestCurrentUser(Guid userId) : ICurrentUser
    {
        public Guid? UserId => userId;
        public Guid? SessionId => null;
        public string? Email => "task-concurrency@example.test";
        public SystemRole? SystemRole => null;
        public bool IsAuthenticated => true;
    }

    private sealed class UtcTimeZoneResolver : ITaskWorkspaceTimeZoneResolver
    {
        public Task<TimeZoneInfo> ResolveAsync(Guid tenantId, Guid workspaceId, CancellationToken cancellationToken = default) => Task.FromResult(TimeZoneInfo.Utc);
    }

    /// <summary>Never authorizes file access; file commands are outside this focused harness.</summary>
    private sealed class DenyingFileAuthorizationService : IFileAuthorizationService
    {
        public Task<bool> CanUploadAttachment(Guid userId, AttachmentOwnerType ownerType, Guid ownerId, CancellationToken cancellationToken = default) => Task.FromResult(false);
        public Task<bool> CanViewWorkspaceFiles(Guid userId, Guid workspaceId, CancellationToken cancellationToken = default) => Task.FromResult(false);
        public Task<bool> CanViewAttachment(Guid userId, Attachment attachment, CancellationToken cancellationToken = default) => Task.FromResult(false);
        public Task<bool> CanDownloadAttachment(Guid userId, Attachment attachment, CancellationToken cancellationToken = default) => Task.FromResult(false);
        public Task<bool> CanDeleteAttachment(Guid userId, Attachment attachment, CancellationToken cancellationToken = default) => Task.FromResult(false);
    }

    private sealed class CoordinatedClock(RaceClockCoordinator coordinator) : IClock
    {
        public DateTimeOffset UtcNow => coordinator.Now();
    }

    private sealed class RaceClockCoordinator
    {
        private readonly Barrier barrier = new(2);
        private int remaining;
        private readonly DateTimeOffset now = new(2026, 7, 26, 0, 0, 0, TimeSpan.Zero);

        public void Arm() => Interlocked.Exchange(ref remaining, 2);

        public DateTimeOffset Now()
        {
            if (Interlocked.Decrement(ref remaining) >= 0)
                barrier.SignalAndWait();
            return now;
        }
    }
}
