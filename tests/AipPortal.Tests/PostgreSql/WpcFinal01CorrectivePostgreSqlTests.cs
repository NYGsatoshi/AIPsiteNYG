using System.Text.Json;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Application.Projects;
using AipPortal.Application.Realtime;
using AipPortal.Application.Tenancy;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Audit;
using AipPortal.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Tests.PostgreSql;

[Collection("PostgreSqlTaskV1")]
public sealed class WpcFinal01CorrectivePostgreSqlTests
{
    private static readonly DateTimeOffset Now = new(2026, 8, 22, 2, 30, 0, TimeSpan.Zero);

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    [Trait("Scope", "WPC02A")]
    public async Task LegacyUnknownVisibilityClassificationIsAuthorizedAuditedAndConcurrencyControlled()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedGraphAsync(
                database,
                "classification",
                visibility: null,
                activationState: ProjectActivationState.LegacyUnknown);

            await using var scope = CreateVisibilityScope(database, graph, graph.OwnerUserId);
            var classified = await scope.Service.UpdateAsync(
                graph.ProjectId,
                new ProjectVisibilityMutationRequest(ProjectVisibility.MembersOnly, 1));

            Assert.True(classified.IsSuccess, classified.Error);
            Assert.Equal(ProjectVisibility.MembersOnly, classified.Value!.Visibility);
            Assert.Equal(2, classified.Value.VersionNo);

            var stale = await scope.Service.UpdateAsync(
                graph.ProjectId,
                new ProjectVisibilityMutationRequest(ProjectVisibility.Restricted, 1));
            Assert.False(stale.IsSuccess);
            Assert.Equal("ConcurrentModification", stale.ErrorDetail?.Code);

            await using var verify = CreateTenantContext(database, graph);
            var project = await verify.Projects.SingleAsync(item => item.Id == graph.ProjectId);
            Assert.Equal(ProjectVisibility.MembersOnly, project.Visibility);
            Assert.Equal(ProjectActivationState.LegacyUnknown, project.ActivationState);
            Assert.Null(project.ActivatedAtUtc);
            Assert.Equal(2, project.VersionNo);
            Assert.Equal(1, await verify.AuditLogs.CountAsync(item =>
                item.Action == "ProjectVisibilityChanged" && item.EntityId == graph.ProjectId));
            Assert.Equal(1, await verify.OutboxEvents.CountAsync(item =>
                item.EventType == "Projects.ProjectChanged.v1" && item.AggregateId == graph.ProjectId));
        });
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    [Trait("Scope", "WPC02A")]
    public async Task NonDefaultVisibilityMutationRequiresWorkspaceGovernanceOrVisibilityCapability()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedGraphAsync(
                database,
                "visibility-authority",
                ProjectVisibility.MembersOnly,
                readerProjectRole: ProjectRole.Manager);

            await using (var deniedScope = CreateVisibilityScope(database, graph, graph.ReaderUserId))
            {
                var denied = await deniedScope.Service.UpdateAsync(
                    graph.ProjectId,
                    new ProjectVisibilityMutationRequest(ProjectVisibility.WorkspaceVisible, 1));
                Assert.False(denied.IsSuccess);
                Assert.Equal("CapabilityDenied", denied.ErrorDetail?.Code);
            }

            await using (var grantContext = CreateTenantContext(database, graph))
            {
                grantContext.Set<CapabilityGrant>().Add(new CapabilityGrant
                {
                    TenantId = graph.TenantId,
                    SubjectUserId = graph.ReaderUserId,
                    CapabilityKey = CapabilityKeys.ProjectVisibilityManage,
                    ScopeType = CapabilityScopeType.Workspace,
                    ScopeId = graph.WorkspaceId,
                    GrantedByUserId = graph.OwnerUserId,
                    GrantedAt = Now.AddMinutes(-1),
                    ExpiresAt = Now.AddHours(1),
                    VersionNo = 1
                });
                await grantContext.SaveChangesAsync();
            }

            await using (var allowedScope = CreateVisibilityScope(database, graph, graph.ReaderUserId))
            {
                var allowed = await allowedScope.Service.UpdateAsync(
                    graph.ProjectId,
                    new ProjectVisibilityMutationRequest(ProjectVisibility.WorkspaceVisible, 1));
                Assert.True(allowed.IsSuccess, allowed.Error);
                Assert.Equal(ProjectVisibility.WorkspaceVisible, allowed.Value!.Visibility);
                Assert.Equal(2, allowed.Value.VersionNo);
            }
        });
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    [Trait("Scope", "WPC02A")]
    public async Task ArchivedProjectMembershipMutationFailsClosedWithoutCommit()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedGraphAsync(
                database,
                "archived-membership",
                ProjectVisibility.MembersOnly,
                status: ProjectStatus.Archived,
                readerProjectRole: ProjectRole.Contributor,
                includeProjectGeneral: true);

            await using (var context = CreateMembershipContext(database, graph))
            {
                var member = await context.ProjectMembers.SingleAsync(item =>
                    item.ProjectId == graph.ProjectId && item.UserId == graph.ReaderUserId);
                member.Role = ProjectRole.Viewer;

                var outcome = await new EfUnitOfWork(context).SaveTaskCommandAsync();
                Assert.Equal(TaskCommandSaveResult.ConcurrencyConflict, outcome.Result);
            }

            await using var verify = CreateTenantContext(database, graph);
            var persisted = await verify.ProjectMembers.SingleAsync(item =>
                item.ProjectId == graph.ProjectId && item.UserId == graph.ReaderUserId);
            Assert.Equal(ProjectRole.Contributor, persisted.Role);
            var participant = await verify.ConversationMembers.SingleAsync(item =>
                item.ConversationId == graph.ProjectGeneralId && item.UserId == graph.ReaderUserId);
            Assert.True(participant.CanRead);
            Assert.True(participant.CanPost);
            Assert.Null(participant.RemovedAt);
        });
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    [Trait("Scope", "WPC02D")]
    public async Task ProjectGeneralMembershipTracksRoleAndRemovalWithoutStalePostingRights()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedGraphAsync(
                database,
                "project-general-sync",
                ProjectVisibility.WorkspaceVisible,
                readerProjectRole: ProjectRole.Contributor,
                includeProjectGeneral: true);

            await using (var context = CreateMembershipContext(database, graph))
            {
                var member = await context.ProjectMembers.SingleAsync(item =>
                    item.ProjectId == graph.ProjectId && item.UserId == graph.ReaderUserId);
                var participant = await context.ConversationMembers.SingleAsync(item =>
                    item.ConversationId == graph.ProjectGeneralId && item.UserId == graph.ReaderUserId);

                member.Role = ProjectRole.Viewer;
                var roleOutcome = await new EfUnitOfWork(context).SaveTaskCommandAsync();
                Assert.True(roleOutcome.IsSaved);
                Assert.Equal(ConversationMemberRole.ReadOnly, participant.Role);
                Assert.True(participant.CanRead);
                Assert.False(participant.CanPost);
                Assert.False(participant.CanCreateThread);

                context.ProjectMembers.Remove(member);
                var removalOutcome = await new EfUnitOfWork(context).SaveTaskCommandAsync();
                Assert.True(removalOutcome.IsSaved);
            }

            await using var verify = CreateTenantContext(database, graph);
            Assert.False(await verify.ProjectMembers.AnyAsync(item =>
                item.ProjectId == graph.ProjectId && item.UserId == graph.ReaderUserId));
            var removedParticipant = await verify.ConversationMembers.SingleAsync(item =>
                item.ConversationId == graph.ProjectGeneralId && item.UserId == graph.ReaderUserId);
            Assert.False(removedParticipant.CanRead);
            Assert.False(removedParticipant.CanPost);
            Assert.False(removedParticipant.CanManageMembers);
            Assert.False(removedParticipant.CanCreateThread);
            Assert.NotNull(removedParticipant.RemovedAt);
        });
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    [Trait("Scope", "WPC02F")]
    public async Task TaskNotificationAndRealtimeUseCanonicalProjectVisibilityAuthorization()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedGraphAsync(
                database,
                "current-auth",
                ProjectVisibility.MembersOnly);

            var currentTenant = TenantScope(graph);
            await using var context = CreateTenantContext(database, graph, currentTenant);
            var inner = new CurrentAuthorizationTargetResolver(
                context,
                currentTenant,
                new MessagingRepository(context));
            var canonical = new CanonicalCurrentAuthorizationTargetResolver(context, inner);

            var membersOnlyNotification = await canonical.ResolveAsync(
                graph.TenantId,
                graph.ReaderUserId,
                graph.TaskNotificationId);
            Assert.True(membersOnlyNotification.IsOwned);
            Assert.False(membersOnlyNotification.IsAvailable);

            var taskEvent = NewTaskEvent(graph);
            var projectEvent = NewProjectEvent(graph);
            Assert.False(await canonical.CanReceiveTaskEventAsync(
                graph.TenantId,
                graph.ReaderUserId,
                RealtimeSubscriptionType.Project,
                graph.ProjectId,
                taskEvent));
            Assert.False(await canonical.CanReceiveProjectEventAsync(
                graph.TenantId,
                graph.ReaderUserId,
                RealtimeSubscriptionType.Workspace,
                graph.WorkspaceId,
                projectEvent));

            var project = await context.Projects.SingleAsync(item => item.Id == graph.ProjectId);
            project.Visibility = ProjectVisibility.WorkspaceVisible;
            await context.SaveChangesAsync();

            var workspaceVisibleNotification = await canonical.ResolveAsync(
                graph.TenantId,
                graph.ReaderUserId,
                graph.TaskNotificationId);
            Assert.True(workspaceVisibleNotification.IsAvailable);
            Assert.True(await canonical.CanReceiveTaskEventAsync(
                graph.TenantId,
                graph.ReaderUserId,
                RealtimeSubscriptionType.Project,
                graph.ProjectId,
                taskEvent));
            Assert.True(await canonical.CanReceiveProjectEventAsync(
                graph.TenantId,
                graph.ReaderUserId,
                RealtimeSubscriptionType.Workspace,
                graph.WorkspaceId,
                projectEvent));

            project.Visibility = ProjectVisibility.Restricted;
            await context.SaveChangesAsync();

            var restrictedNotification = await canonical.ResolveAsync(
                graph.TenantId,
                graph.ReaderUserId,
                graph.TaskNotificationId);
            Assert.True(restrictedNotification.IsOwned);
            Assert.False(restrictedNotification.IsAvailable);
            Assert.False(await canonical.CanReceiveTaskEventAsync(
                graph.TenantId,
                graph.ReaderUserId,
                RealtimeSubscriptionType.Project,
                graph.ProjectId,
                taskEvent));
            Assert.False(await canonical.CanReceiveProjectEventAsync(
                graph.TenantId,
                graph.ReaderUserId,
                RealtimeSubscriptionType.Workspace,
                graph.WorkspaceId,
                projectEvent));
        });
    }

    private static DurableEventEnvelope NewTaskEvent(Graph graph) => new(
        Guid.NewGuid(),
        "Projects.TaskChanged.v1",
        RealtimeEventCatalog.PayloadSchemaVersion1,
        Now,
        graph.TenantId,
        "Task",
        graph.TaskId,
        1,
        RealtimeActor.System(),
        null,
        null,
        JsonSerializer.SerializeToElement(new
        {
            projectId = graph.ProjectId,
            taskId = graph.TaskId,
            requiresRefetch = true
        }));

    private static DurableEventEnvelope NewProjectEvent(Graph graph) => new(
        Guid.NewGuid(),
        "Projects.ProjectChanged.v1",
        RealtimeEventCatalog.PayloadSchemaVersion1,
        Now,
        graph.TenantId,
        "Project",
        graph.ProjectId,
        1,
        RealtimeActor.System(),
        null,
        null,
        JsonSerializer.SerializeToElement(new
        {
            workspaceId = graph.WorkspaceId,
            projectId = graph.ProjectId,
            requiresRefetch = true
        }));

    private static async Task<Graph> SeedGraphAsync(
        string database,
        string suffix,
        ProjectVisibility? visibility,
        ProjectActivationState activationState = ProjectActivationState.Activated,
        ProjectStatus status = ProjectStatus.Active,
        ProjectRole? readerProjectRole = null,
        bool includeProjectGeneral = false)
    {
        var run = Guid.NewGuid().ToString("N");
        var tenant = new Tenant
        {
            Name = $"WPC Final01 {suffix} {run}",
            DisplayName = $"WPC Final01 {suffix}",
            Slug = $"wpc-final01-{suffix}-{run}",
            Status = TenantStatus.Active
        };
        var owner = NewUser($"owner-{suffix}-{run}");
        var reader = NewUser($"reader-{suffix}-{run}");

        await using (var platform = PostgreSqlMigrationTestDatabase.CreatePlatformContext(database))
        {
            platform.AddRange(tenant, owner, reader);
            await platform.SaveChangesAsync();
        }

        var workspace = new Workspace
        {
            TenantId = tenant.Id,
            Name = $"Workspace {suffix}",
            Slug = $"workspace-{suffix}-{run}",
            Status = WorkspaceStatus.Active,
            CreatedByUserId = owner.Id
        };
        var activated = activationState == ProjectActivationState.Activated;
        var project = new Project
        {
            TenantId = tenant.Id,
            WorkspaceId = workspace.Id,
            OwnerUserId = owner.Id,
            Name = $"Project {suffix}",
            Slug = $"project-{suffix}-{run}",
            Status = status,
            Visibility = visibility,
            ActivationState = activationState,
            ActivatedAtUtc = activated ? Now : null,
            ActivationVersion = activated ? 1 : null,
            ArchivedFromStatus = status == ProjectStatus.Archived ? ProjectStatus.Active : null,
            VersionNo = 1,
            CreatedByUserId = owner.Id
        };
        var task = new TaskItem
        {
            TenantId = tenant.Id,
            WorkspaceId = workspace.Id,
            ProjectId = project.Id,
            Title = $"Task {suffix}",
            Status = TaskItemStatus.NotStarted,
            Priority = TaskPriority.Medium,
            VersionNo = 1,
            CreatedByUserId = owner.Id
        };
        var notification = new Notification
        {
            TenantId = tenant.Id,
            UserId = reader.Id,
            NotificationType = NotificationType.TaskAssigned,
            Title = "Task assigned",
            RelatedEntityType = "Task",
            RelatedEntityId = task.Id,
            CreatedAt = Now,
            StateVersion = 1
        };

        Conversation? projectGeneral = null;
        if (includeProjectGeneral)
        {
            projectGeneral = new Conversation
            {
                TenantId = tenant.Id,
                WorkspaceId = workspace.Id,
                ProjectId = project.Id,
                Type = ConversationType.ProjectChannel,
                Title = "general",
                Visibility = ConversationVisibility.PublicWithinScope,
                DefaultKind = ConversationDefaultKind.ProjectGeneral,
                CreatedByUserId = owner.Id
            };
        }

        var graph = new Graph(
            tenant.Id,
            tenant.Slug,
            workspace.Id,
            project.Id,
            task.Id,
            notification.Id,
            projectGeneral?.Id ?? Guid.Empty,
            owner.Id,
            reader.Id);

        await using (var context = CreateTenantContext(database, graph))
        {
            context.AddRange(
                new TenantUser
                {
                    TenantId = tenant.Id,
                    UserId = owner.Id,
                    Role = TenantUserRole.Owner,
                    Status = TenantUserStatus.Active,
                    JoinedAt = Now
                },
                new TenantUser
                {
                    TenantId = tenant.Id,
                    UserId = reader.Id,
                    Role = TenantUserRole.Member,
                    Status = TenantUserStatus.Active,
                    JoinedAt = Now
                },
                workspace,
                new WorkspaceMember
                {
                    TenantId = tenant.Id,
                    WorkspaceId = workspace.Id,
                    UserId = owner.Id,
                    Role = WorkspaceRole.Owner,
                    Status = MembershipStatus.Active,
                    JoinedAt = Now
                },
                new WorkspaceMember
                {
                    TenantId = tenant.Id,
                    WorkspaceId = workspace.Id,
                    UserId = reader.Id,
                    Role = WorkspaceRole.Member,
                    Status = MembershipStatus.Active,
                    JoinedAt = Now
                },
                project,
                new ProjectMember
                {
                    TenantId = tenant.Id,
                    ProjectId = project.Id,
                    UserId = owner.Id,
                    Role = ProjectRole.Owner,
                    JoinedAt = Now
                },
                task,
                notification);

            if (readerProjectRole.HasValue)
            {
                context.ProjectMembers.Add(new ProjectMember
                {
                    TenantId = tenant.Id,
                    ProjectId = project.Id,
                    UserId = reader.Id,
                    Role = readerProjectRole.Value,
                    JoinedAt = Now
                });
            }

            if (projectGeneral is not null)
            {
                context.Conversations.Add(projectGeneral);
                context.ConversationMembers.Add(new ConversationMember
                {
                    TenantId = tenant.Id,
                    ConversationId = projectGeneral.Id,
                    UserId = owner.Id,
                    Role = ConversationMemberRole.Admin,
                    CanRead = true,
                    CanPost = true,
                    CanManageMembers = true,
                    CanCreateThread = true,
                    JoinedAt = Now
                });
                if (readerProjectRole.HasValue)
                {
                    context.ConversationMembers.Add(new ConversationMember
                    {
                        TenantId = tenant.Id,
                        ConversationId = projectGeneral.Id,
                        UserId = reader.Id,
                        Role = ConversationMemberRole.Member,
                        CanRead = true,
                        CanPost = true,
                        CanManageMembers = false,
                        CanCreateThread = true,
                        JoinedAt = Now
                    });
                }
            }

            await context.SaveChangesAsync();
        }

        return graph;
    }

    private static VisibilityScope CreateVisibilityScope(string database, Graph graph, Guid userId)
    {
        var currentTenant = TenantScope(graph);
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(database)
            .AddInterceptors(
                new ProjectGovernanceSaveChangesInterceptor(),
                new ProjectGeneralMembershipSaveChangesInterceptor(new FixedClock(Now)))
            .Options;
        var db = new AppDbContext(options, currentTenant);
        var clock = new FixedClock(Now);
        var currentUser = new TestCurrentUser(userId);
        var projectRepository = new ProjectRepository(db);
        var workspaceRepository = new WorkspaceRepository(db);
        var tenantRepository = new TenantRepository(db);
        var capabilityEvaluator = new CapabilityGrantEvaluator(
            new CapabilityGrantRepository(db),
            tenantRepository,
            workspaceRepository,
            currentTenant,
            clock);
        var outbox = new TransactionalOutbox(new OutboxEventRepository(db), currentTenant, clock);
        var authorizationChanges = new AuthorizationStateChangePublisher(outbox, currentTenant, clock);
        var service = new ProjectVisibilityService(
            projectRepository,
            workspaceRepository,
            capabilityEvaluator,
            currentUser,
            currentTenant,
            new DbAuditLogger(db, clock, currentUser, currentTenant),
            new BusinessInvalidationPublisher(outbox, currentTenant, clock),
            authorizationChanges,
            new EfUnitOfWork(db));
        return new VisibilityScope(db, service);
    }

    private static AppDbContext CreateMembershipContext(string database, Graph graph)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(database)
            .AddInterceptors(new ProjectGeneralMembershipSaveChangesInterceptor(new FixedClock(Now)))
            .Options;
        return new AppDbContext(options, TenantScope(graph));
    }

    private static AppDbContext CreateTenantContext(string database, Graph graph) =>
        CreateTenantContext(database, graph, TenantScope(graph));

    private static AppDbContext CreateTenantContext(
        string database,
        Graph graph,
        CurrentTenantService currentTenant)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(database).Options;
        return new AppDbContext(options, currentTenant);
    }

    private static CurrentTenantService TenantScope(Graph graph)
    {
        var currentTenant = new CurrentTenantService();
        currentTenant.SetTenant(graph.TenantId, graph.TenantSlug);
        return currentTenant;
    }

    private static User NewUser(string suffix) => new()
    {
        DisplayName = $"WPC Final01 {suffix}",
        Email = $"{suffix}@example.invalid".ToLowerInvariant(),
        NormalizedEmail = $"{suffix}@example.invalid".ToUpperInvariant(),
        PasswordHash = "hash",
        Status = UserStatus.Active,
        SystemRole = SystemRole.NormalUser
    };

    private sealed record Graph(
        Guid TenantId,
        string TenantSlug,
        Guid WorkspaceId,
        Guid ProjectId,
        Guid TaskId,
        Guid TaskNotificationId,
        Guid ProjectGeneralId,
        Guid OwnerUserId,
        Guid ReaderUserId);

    private sealed class FixedClock(DateTimeOffset utcNow) : IClock
    {
        public DateTimeOffset UtcNow { get; } = utcNow;
    }

    private sealed class TestCurrentUser(Guid userId) : ICurrentUser
    {
        public Guid? UserId { get; } = userId;
        public Guid? SessionId => null;
        public string? Email => null;
        public SystemRole? SystemRole => AipPortal.Domain.Enums.SystemRole.NormalUser;
        public bool IsAuthenticated => true;
    }

    private sealed class VisibilityScope(AppDbContext db, ProjectVisibilityService service) : IAsyncDisposable
    {
        public AppDbContext Db { get; } = db;
        public ProjectVisibilityService Service { get; } = service;
        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }
}
