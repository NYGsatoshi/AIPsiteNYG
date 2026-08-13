using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Application.Realtime;
using AipPortal.Application.Groups;
using AipPortal.Application.Messaging;
using AipPortal.Application.Planning;
using AipPortal.Application.Projects;
using AipPortal.Application.Search;
using AipPortal.Application.Tenancy;
using AipPortal.Application.Workspaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Audit;
using AipPortal.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;

namespace AipPortal.Tests.PostgreSql;

public sealed class Wpc01WorkspaceCreationPostgreSqlTests
{
    private const string PreviousMigration = "20260803041347_AddTaskDeadlineDigestLedger";

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    [Trait("Scope", "WPC01")]
    public async Task MigrationUpgradesAndRollsBackWithoutChangingProjectVisibilitySchema()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database, PreviousMigration);
            var graph = await TaskV1MigrationRawSqlSeed.CreateGraphAsync(database, "wpc01-upgrade");

            Assert.False(await TableExistsAsync(database, "idempotency_records"));
            Assert.False(await ColumnExistsAsync(database, "projects", "Visibility"));

            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);

            Assert.True(await TableExistsAsync(database, "idempotency_records"));
            Assert.True(await IndexExistsAsync(database, "UX_idempotency_tenant_actor_operation_key"));
            Assert.False(await ColumnExistsAsync(database, "projects", "Visibility"));
            Assert.Equal(
                1,
                await PostgreSqlMigrationTestDatabase.ScalarAsync<long>(
                    database,
                    "SELECT COUNT(*) FROM projects WHERE \"Id\" = @id;",
                    ("id", graph.ProjectId)));
            await using (var current = PostgreSqlMigrationTestDatabase.CreatePlatformContext(database))
            {
                Assert.Empty(await current.Database.GetPendingMigrationsAsync());
                Assert.False(current.Database.HasPendingModelChanges());
            }

            await PostgreSqlMigrationTestDatabase.MigrateAsync(database, PreviousMigration);
            Assert.False(await TableExistsAsync(database, "idempotency_records"));
            Assert.Equal(
                1,
                await PostgreSqlMigrationTestDatabase.ScalarAsync<long>(
                    database,
                    "SELECT COUNT(*) FROM projects WHERE \"Id\" = @id;",
                    ("id", graph.ProjectId)));

            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            Assert.True(await TableExistsAsync(database, "idempotency_records"));
        });
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    [Trait("Scope", "WPC01")]
    public async Task CoordinatorSeamConcurrentRetryCommitsOneLogicalWorkspaceAndOneSideEffectSet()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedAuthorityAsync(database, "concurrent");
            await using var firstScope = CreateServiceScope(database, graph);
            await using var secondScope = CreateServiceScope(database, graph);
            var request = new CreateWorkspaceRequest("Concurrent Workspace", "Created once", null);

            var results = await Task.WhenAll(
                firstScope.Service.CreateAsync(request, "wpc01-concurrent-key"),
                secondScope.Service.CreateAsync(request, "wpc01-concurrent-key"));

            Assert.All(results, result => Assert.True(result.IsSuccess, result.Error));
            var workspaceId = results[0].Value!.Id;
            Assert.Equal(workspaceId, results[1].Value!.Id);

            await using var verification = CreateTenantContext(database, graph.TenantId, graph.TenantSlug);
            Assert.Equal(1, await verification.Workspaces.CountAsync());
            var owner = Assert.Single(await verification.WorkspaceMembers.AsNoTracking().ToListAsync());
            Assert.Equal(workspaceId, owner.WorkspaceId);
            Assert.Equal(graph.UserId, owner.UserId);
            Assert.Equal(WorkspaceRole.Owner, owner.Role);
            Assert.Equal(MembershipStatus.Active, owner.Status);
            Assert.Equal(1, await verification.IdempotencyRecords.CountAsync());
            Assert.Equal(1, await verification.AuditLogs.CountAsync(item => item.Action == "WorkspaceCreated"));
            Assert.Equal(1, await verification.OutboxEvents.CountAsync(item => item.EventType == "Security.AuthorizationStateChanged.v1"));
        });
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    [Trait("Scope", "WPC01")]
    public async Task InitializationFailureRollsBackClaimWorkspaceOwnerAuditAndOutbox()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedAuthorityAsync(database, "rollback");
            var request = new CreateWorkspaceRequest("Rollback Workspace", null, null);

            await using (var failing = CreateServiceScope(
                             database,
                             graph,
                             requiredInitialization: new FailingRequiredInitialization()))
            {
                var failure = await failing.Service.CreateAsync(request, "wpc01-rollback-key");
                Assert.False(failure.IsSuccess);
                Assert.Equal("DependencyUnavailable", failure.ErrorDetail?.Code);
            }

            await AssertCreationCountsAsync(database, graph, expected: 0);

            await using (var retry = CreateServiceScope(database, graph))
            {
                var result = await retry.Service.CreateAsync(request, "wpc01-rollback-key");
                Assert.True(result.IsSuccess, result.Error);
            }

            await AssertCreationCountsAsync(database, graph, expected: 1);
        });
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    [Trait("Scope", "WPC01")]
    public async Task UnavailableCanonicalGeneralFailsClosedWithoutCreatingAnyRows()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedAuthorityAsync(database, "general-gate");
            await using var scope = CreateServiceScope(
                database,
                graph,
                requiredInitialization: new UnavailableWorkspaceRequiredInitialization());

            var capability = await scope.Service.GetCapabilitiesAsync();
            var failure = await scope.Service.CreateAsync(
                new CreateWorkspaceRequest("Unavailable general", null, null),
                "wpc01-general-gate");

            Assert.True(capability.IsSuccess);
            Assert.False(capability.Value!.CanCreate);
            Assert.False(failure.IsSuccess);
            Assert.Equal("DependencyUnavailable", failure.ErrorDetail?.Code);
            await AssertCreationCountsAsync(database, graph, expected: 0);
        });
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    [Trait("Scope", "WPC01")]
    public async Task ConcurrentRetryWithUnavailableGeneralLeavesNoCreateSideEffects()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedAuthorityAsync(database, "general-concurrent-gate");
            await using var first = CreateServiceScope(
                database,
                graph,
                requiredInitialization: new UnavailableWorkspaceRequiredInitialization());
            await using var second = CreateServiceScope(
                database,
                graph,
                requiredInitialization: new UnavailableWorkspaceRequiredInitialization());
            var request = new CreateWorkspaceRequest("Unavailable concurrent general", null, null);

            var results = await Task.WhenAll(
                first.Service.CreateAsync(request, "wpc01-general-concurrent"),
                second.Service.CreateAsync(request, "wpc01-general-concurrent"));

            Assert.All(results, result =>
            {
                Assert.False(result.IsSuccess);
                Assert.Equal("DependencyUnavailable", result.ErrorDetail?.Code);
            });
            await AssertCreationCountsAsync(database, graph, expected: 0);
        });
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    [Trait("Scope", "WPC01")]
    public async Task CoordinatorSeamDuplicateDisplayNamesPersistWithDistinctBoundedSlugs()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedAuthorityAsync(database, "duplicate-slugs");
            await using var scope = CreateServiceScope(database, graph);
            var request = new CreateWorkspaceRequest(new string('A', 160), null, null);

            var first = await scope.Service.CreateAsync(request, "wpc01-duplicate-slug-1");
            scope.Db.ChangeTracker.Clear();
            var second = await scope.Service.CreateAsync(request, "wpc01-duplicate-slug-2");

            Assert.True(first.IsSuccess, first.Error);
            Assert.True(second.IsSuccess, second.Error);
            Assert.NotEqual(first.Value!.Id, second.Value!.Id);
            await using var verification = CreateTenantContext(database, graph.TenantId, graph.TenantSlug);
            var workspaces = await verification.Workspaces.AsNoTracking().ToListAsync();
            Assert.Equal(2, workspaces.Count);
            Assert.All(workspaces, item => Assert.True(item.Slug.Length <= 120));
            Assert.Equal(2, workspaces.Select(item => item.Slug).Distinct(StringComparer.Ordinal).Count());
        });
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    [Trait("Scope", "WPC01")]
    public async Task PlanningProjectDiscoveryRequiresExplicitProjectMembership()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedPlanningAccessGraphAsync(database);
            await using var db = CreateTenantContext(database, graph.TenantId, graph.TenantSlug);
            var users = new UserRepository(db);
            var workspaces = new WorkspaceRepository(db);
            var groups = new GroupRepository(db);
            var projectRepository = new ProjectRepository(db);
            var workspaceAuthorization = new WorkspaceAuthorizationService(
                users,
                workspaces,
                new TenantAuthorizationService(new TenantRepository(db)));
            var groupAuthorization = new GroupAuthorizationService(groups, workspaces, workspaceAuthorization);
            var projectAuthorization = new ProjectAuthorizationService(
                projectRepository,
                workspaceAuthorization,
                groupAuthorization,
                groups);
            var messaging = new MessagingRepository(db);
            var planning = new PlanningRepository(db);

            var invalidProjectChannel = new Conversation
            {
                TenantId = graph.TenantId,
                WorkspaceId = graph.WorkspaceId,
                Type = ConversationType.ProjectChannel,
                ProjectId = null,
                Title = "Invalid unscoped project channel",
                CreatedByUserId = graph.OwnerUserId
            };
            db.AddRange(
                invalidProjectChannel,
                new ConversationMember
                {
                    TenantId = graph.TenantId,
                    ConversationId = invalidProjectChannel.Id,
                    UserId = graph.OwnerUserId,
                    Role = ConversationMemberRole.Admin,
                    JoinedAt = TestClock.Value
                },
                new Message
                {
                    TenantId = graph.TenantId,
                    WorkspaceId = graph.WorkspaceId,
                    ConversationId = invalidProjectChannel.Id,
                    AuthorUserId = graph.OwnerUserId,
                    Body = "Must remain hidden"
                });
            await db.SaveChangesAsync();
            var conversationAuthorization = new ConversationAuthorizationService(messaging, projectAuthorization);

            Assert.False(await projectAuthorization.CanViewProject(graph.OrdinaryUserId, graph.ProjectId));
            Assert.False(await projectAuthorization.CanManageProject(graph.OrdinaryUserId, graph.ProjectId));
            Assert.False(await projectAuthorization.CanViewProject(graph.SystemAdminUserId, graph.ProjectId));
            Assert.True(await projectAuthorization.CanViewProject(graph.OwnerUserId, graph.ProjectId));
            Assert.DoesNotContain(
                await projectRepository.ListVisibleAsync(graph.OrdinaryUserId),
                project => project.Id == graph.ProjectId);
            Assert.DoesNotContain(
                (await messaging.ListForUserAsync(graph.OrdinaryUserId, 1, 20)).Items,
                conversation => conversation.Id == graph.ConversationId);
            Assert.Contains(
                (await messaging.ListForUserAsync(graph.OwnerUserId, 1, 20)).Items,
                conversation => conversation.Id == graph.ConversationId);
            Assert.DoesNotContain(
                (await messaging.ListForUserAsync(graph.OwnerUserId, 1, 20)).Items,
                conversation => conversation.Id == invalidProjectChannel.Id);
            Assert.False(await conversationAuthorization.CanViewConversation(
                graph.OwnerUserId,
                invalidProjectChannel.Id));
            Assert.False(await planning.CanViewMyTasksProjectAsync(graph.OrdinaryUserId, graph.ProjectId));
            Assert.True(await planning.CanViewMyTasksProjectAsync(graph.OwnerUserId, graph.ProjectId));
            Assert.DoesNotContain(
                (await planning.ListMyTasksAsync(
                    graph.OrdinaryUserId,
                    new MyTasksQuery(
                        View: MyTasksRelationshipView.Assigned,
                        WorkspaceId: graph.WorkspaceId,
                        ProjectId: graph.ProjectId),
                    TestClock.Value)).Items,
                item => item.TaskId == graph.TaskId);
            Assert.Contains(
                await projectRepository.ListVisibleAsync(graph.OwnerUserId),
                project => project.Id == graph.ProjectId);

            var ordinarySearch = await new DbSearchService(
                    db,
                    new TestCurrentUser(graph.OrdinaryUserId),
                    conversationAuthorization)
                .SearchAsync(new SearchRequest(
                    WorkspaceId: graph.WorkspaceId,
                    ProjectId: graph.ProjectId,
                    PageSize: 50));
            var systemAdminSearch = await new DbSearchService(
                    db,
                    new TestCurrentUser(graph.SystemAdminUserId, SystemRole.SystemAdmin),
                    conversationAuthorization)
                .SearchAsync(new SearchRequest(
                    WorkspaceId: graph.WorkspaceId,
                    ProjectId: graph.ProjectId,
                    PageSize: 50));
            var ownerSearch = await new DbSearchService(
                    db,
                    new TestCurrentUser(graph.OwnerUserId),
                    conversationAuthorization)
                .SearchAsync(new SearchRequest(
                    WorkspaceId: graph.WorkspaceId,
                    ProjectId: graph.ProjectId,
                    PageSize: 50));

            Assert.True(ordinarySearch.IsSuccess, ordinarySearch.Error);
            Assert.True(systemAdminSearch.IsSuccess, systemAdminSearch.Error);
            Assert.True(ownerSearch.IsSuccess, ownerSearch.Error);
            var protectedIds = new[]
            {
                graph.ProjectId,
                graph.TaskId,
                graph.ArtifactId,
                graph.ActivityLogId,
                graph.CommentId,
                graph.MessageId
            };
            Assert.DoesNotContain(ordinarySearch.Value!.Items, item => protectedIds.Contains(item.Id));
            Assert.DoesNotContain(systemAdminSearch.Value!.Items, item => protectedIds.Contains(item.Id));
            Assert.All(protectedIds, id => Assert.Contains(ownerSearch.Value!.Items, item => item.Id == id));

            var project = await db.Projects.SingleAsync(item => item.Id == graph.ProjectId);
            project.Status = ProjectStatus.Suspended;
            await db.SaveChangesAsync();
            db.ChangeTracker.Clear();

            Assert.False(await projectAuthorization.CanViewProject(graph.OrdinaryUserId, graph.ProjectId));
            Assert.False(await projectAuthorization.CanManageProject(graph.OrdinaryUserId, graph.ProjectId));
            Assert.True(await projectAuthorization.CanViewProject(graph.OwnerUserId, graph.ProjectId));
            Assert.DoesNotContain(
                await projectRepository.ListVisibleAsync(graph.OrdinaryUserId),
                item => item.Id == graph.ProjectId);
            Assert.DoesNotContain(
                (await messaging.ListForUserAsync(graph.OrdinaryUserId, 1, 20)).Items,
                conversation => conversation.Id == graph.ConversationId);
            Assert.False(await planning.CanViewMyTasksProjectAsync(graph.OrdinaryUserId, graph.ProjectId));

            var suspendedSearch = await new DbSearchService(
                    db,
                    new TestCurrentUser(graph.OrdinaryUserId),
                    conversationAuthorization)
                .SearchAsync(new SearchRequest(
                    WorkspaceId: graph.WorkspaceId,
                    ProjectId: graph.ProjectId,
                    PageSize: 50));
            Assert.True(suspendedSearch.IsSuccess, suspendedSearch.Error);
            Assert.DoesNotContain(suspendedSearch.Value!.Items, item => protectedIds.Contains(item.Id));
        });
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    [Trait("Scope", "WPC01")]
    public async Task ActiveGroupedProjectReadBoundaryIsEquivalentAcrossDetailListSearchMessagingAndMyTasks()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedActiveVisibilityGraphAsync(database);
            await using var db = CreateTenantContext(database, graph.TenantId, graph.TenantSlug);
            var users = new UserRepository(db);
            var workspaces = new WorkspaceRepository(db);
            var groups = new GroupRepository(db);
            var projectRepository = new ProjectRepository(db);
            var workspaceAuthorization = new WorkspaceAuthorizationService(
                users,
                workspaces,
                new TenantAuthorizationService(new TenantRepository(db)));
            var projectAuthorization = new ProjectAuthorizationService(
                projectRepository,
                workspaceAuthorization,
                new GroupAuthorizationService(groups, workspaces, workspaceAuthorization),
                groups);
            var messaging = new MessagingRepository(db);
            var conversationAuthorization = new ConversationAuthorizationService(messaging, projectAuthorization);
            var planning = new PlanningRepository(db);

            var groupedExpectations = new[]
            {
                new ProjectReadExpectation("explicit ProjectMember", graph.ExplicitProjectMemberUserId, SystemRole.NormalUser, true),
                new ProjectReadExpectation("authorized GroupMember", graph.GroupMemberUserId, SystemRole.NormalUser, true),
                new ProjectReadExpectation("Workspace Owner", graph.WorkspaceOwnerUserId, SystemRole.NormalUser, true),
                new ProjectReadExpectation("Workspace Admin", graph.WorkspaceAdminUserId, SystemRole.NormalUser, true),
                new ProjectReadExpectation("ordinary Workspace Member outside Group", graph.OrdinaryWorkspaceMemberUserId, SystemRole.NormalUser, false),
                new ProjectReadExpectation("Workspace Adviser outside Group", graph.AdviserUserId, SystemRole.NormalUser, false),
                new ProjectReadExpectation("Project owner field without policy membership", graph.OwnerFieldOnlyUserId, SystemRole.NormalUser, false),
                new ProjectReadExpectation("active SystemAdmin", graph.SystemAdminUserId, SystemRole.SystemAdmin, true),
                new ProjectReadExpectation("revoked Workspace member with stale memberships", graph.RevokedWorkspaceMemberUserId, SystemRole.NormalUser, false)
            };

            foreach (var expectation in groupedExpectations)
            {
                await AssertProjectReadParityAsync(
                    db,
                    projectAuthorization,
                    projectRepository,
                    messaging,
                    graph.GroupedProject,
                    expectation);
            }

            await AssertProjectReadParityAsync(
                db,
                projectAuthorization,
                projectRepository,
                messaging,
                graph.UngroupedProject,
                new ProjectReadExpectation(
                    "ordinary Workspace Member on ungrouped Active Project",
                    graph.OrdinaryWorkspaceMemberUserId,
                    SystemRole.NormalUser,
                    true));

            Assert.False(await planning.CanViewMyTasksProjectAsync(
                graph.OrdinaryWorkspaceMemberUserId,
                graph.GroupedProject.ProjectId));
            Assert.False(await planning.CanViewMyTasksProjectAsync(
                graph.AdviserUserId,
                graph.GroupedProject.ProjectId));
            Assert.False(await planning.CanViewMyTasksProjectAsync(
                graph.OwnerFieldOnlyUserId,
                graph.GroupedProject.ProjectId));
            Assert.False(await planning.CanViewMyTasksProjectAsync(
                graph.RevokedWorkspaceMemberUserId,
                graph.GroupedProject.ProjectId));
            Assert.True(await planning.CanViewMyTasksProjectAsync(
                graph.OrdinaryWorkspaceMemberUserId,
                graph.UngroupedProject.ProjectId));

            var ordinaryMyTasks = await planning.ListMyTasksAsync(
                graph.OrdinaryWorkspaceMemberUserId,
                new MyTasksQuery(
                    View: MyTasksRelationshipView.Assigned,
                    WorkspaceId: graph.WorkspaceId),
                TestClock.Value);
            Assert.DoesNotContain(ordinaryMyTasks.Items, item => item.TaskId == graph.GroupedProject.TaskId);
            Assert.Contains(ordinaryMyTasks.Items, item => item.TaskId == graph.UngroupedProject.TaskId);

            var adviserMyTasks = await planning.ListMyTasksAsync(
                graph.AdviserUserId,
                new MyTasksQuery(
                    View: MyTasksRelationshipView.Assigned,
                    WorkspaceId: graph.WorkspaceId,
                    ProjectId: graph.GroupedProject.ProjectId),
                TestClock.Value);
            Assert.DoesNotContain(adviserMyTasks.Items, item => item.TaskId == graph.AdviserTaskId);

            var ownerFieldMyTasks = await planning.ListMyTasksAsync(
                graph.OwnerFieldOnlyUserId,
                new MyTasksQuery(
                    View: MyTasksRelationshipView.Assigned,
                    WorkspaceId: graph.WorkspaceId,
                    ProjectId: graph.GroupedProject.ProjectId),
                TestClock.Value);
            Assert.DoesNotContain(ownerFieldMyTasks.Items, item => item.TaskId == graph.OwnerFieldTaskId);

            const string nestedNeedle = "WpcNestedThreadAuthorizationNeedle";
            var firstThread = new Conversation
            {
                TenantId = graph.TenantId,
                WorkspaceId = graph.WorkspaceId,
                ProjectId = graph.GroupedProject.ProjectId,
                Type = ConversationType.Thread,
                ParentConversationId = graph.GroupedProject.ConversationId,
                RootConversationId = graph.GroupedProject.ConversationId,
                Title = "WPC first Project thread",
                CreatedByUserId = graph.WorkspaceOwnerUserId
            };
            var secondThread = new Conversation
            {
                TenantId = graph.TenantId,
                WorkspaceId = graph.WorkspaceId,
                ProjectId = graph.GroupedProject.ProjectId,
                Type = ConversationType.Thread,
                ParentConversationId = firstThread.Id,
                RootConversationId = graph.GroupedProject.ConversationId,
                Title = "WPC second Project thread",
                CreatedByUserId = graph.WorkspaceOwnerUserId
            };
            var nestedThread = new Conversation
            {
                TenantId = graph.TenantId,
                WorkspaceId = graph.WorkspaceId,
                ProjectId = graph.GroupedProject.ProjectId,
                Type = ConversationType.Thread,
                ParentConversationId = secondThread.Id,
                RootConversationId = graph.GroupedProject.ConversationId,
                Title = nestedNeedle,
                CreatedByUserId = graph.WorkspaceOwnerUserId
            };
            var nestedMessage = new Message
            {
                TenantId = graph.TenantId,
                WorkspaceId = graph.WorkspaceId,
                ConversationId = nestedThread.Id,
                AuthorUserId = graph.WorkspaceOwnerUserId,
                Body = $"{nestedNeedle} protected message body"
            };
            db.Conversations.AddRange(firstThread, secondThread, nestedThread);
            db.ConversationMembers.AddRange(
                NewReadableConversationMember(graph, firstThread.Id, graph.ExplicitProjectMemberUserId),
                NewReadableConversationMember(graph, secondThread.Id, graph.ExplicitProjectMemberUserId),
                NewReadableConversationMember(graph, nestedThread.Id, graph.ExplicitProjectMemberUserId));
            db.Messages.Add(nestedMessage);
            await db.SaveChangesAsync();

            var revokedAncestorMember = await db.ConversationMembers.SingleAsync(member =>
                member.ConversationId == firstThread.Id &&
                member.UserId == graph.ExplicitProjectMemberUserId);
            revokedAncestorMember.RemovedAt = TestClock.Value;
            await db.SaveChangesAsync();
            db.ChangeTracker.Clear();

            Assert.False(await conversationAuthorization.CanViewConversation(
                graph.ExplicitProjectMemberUserId,
                nestedThread.Id));
            var nestedSearch = await new DbSearchService(
                    db,
                    new TestCurrentUser(graph.ExplicitProjectMemberUserId),
                    conversationAuthorization)
                .SearchAsync(new SearchRequest(
                    nestedNeedle,
                    SearchResultType.Message,
                    WorkspaceId: graph.WorkspaceId,
                    ProjectId: graph.GroupedProject.ProjectId,
                    PageSize: 50));
            Assert.True(nestedSearch.IsSuccess, nestedSearch.Error);
            Assert.DoesNotContain(nestedSearch.Value!.Items, item => item.Id == nestedMessage.Id);
        });
    }

    private static ConversationMember NewReadableConversationMember(
        ActiveVisibilityGraph graph,
        Guid conversationId,
        Guid userId) => new()
    {
        TenantId = graph.TenantId,
        ConversationId = conversationId,
        UserId = userId,
        Role = ConversationMemberRole.Member,
        CanRead = true,
        CanPost = true,
        JoinedAt = TestClock.Value
    };

    private static async Task AssertProjectReadParityAsync(
        AppDbContext db,
        ProjectAuthorizationService projectAuthorization,
        ProjectRepository projectRepository,
        MessagingRepository messaging,
        ProjectResourceGraph project,
        ProjectReadExpectation expectation)
    {
        var canView = await projectAuthorization.CanViewProject(expectation.UserId, project.ProjectId);
        var listed = (await projectRepository.ListVisibleAsync(expectation.UserId))
            .Any(item => item.Id == project.ProjectId);
        var search = await new DbSearchService(
                db,
                new TestCurrentUser(expectation.UserId, expectation.SystemRole),
                new ConversationAuthorizationService(messaging, projectAuthorization))
            .SearchAsync(new SearchRequest(
                project.Needle,
                WorkspaceId: project.WorkspaceId,
                ProjectId: project.ProjectId,
                PageSize: 50));
        Assert.True(search.IsSuccess, $"{expectation.Label}: {search.Error}");

        var searchIds = search.Value!.Items.Select(item => item.Id).ToHashSet();
        var protectedIds = new[]
        {
            project.ProjectId,
            project.TaskId,
            project.ArtifactId,
            project.ActivityLogId,
            project.CommentId,
            project.MessageId
        };
        var conversationVisible = (await messaging.ListForUserAsync(expectation.UserId, 1, 100))
            .Items.Any(item => item.Id == project.ConversationId);

        Assert.Equal(expectation.Expected, canView);
        Assert.Equal(expectation.Expected, listed);
        Assert.Equal(expectation.Expected, conversationVisible);
        foreach (var protectedId in protectedIds)
        {
            Assert.Equal(
                expectation.Expected,
                searchIds.Contains(protectedId));
        }
    }

    private static async Task AssertCreationCountsAsync(
        string connectionString,
        AuthorityGraph graph,
        int expected)
    {
        await using var verification = CreateTenantContext(connectionString, graph.TenantId, graph.TenantSlug);
        Assert.Equal(expected, await verification.Workspaces.CountAsync());
        Assert.Equal(expected, await verification.WorkspaceMembers.CountAsync());
        Assert.Equal(0, await verification.Conversations.CountAsync());
        Assert.Equal(0, await verification.ConversationMembers.CountAsync());
        Assert.Equal(expected, await verification.IdempotencyRecords.CountAsync());
        Assert.Equal(expected, await verification.AuditLogs.CountAsync(item => item.Action == "WorkspaceCreated"));
        Assert.Equal(expected, await verification.OutboxEvents.CountAsync(item => item.EventType == "Security.AuthorizationStateChanged.v1"));
    }

    private static async Task<AuthorityGraph> SeedAuthorityAsync(string connectionString, string suffix)
    {
        await using var context = PostgreSqlMigrationTestDatabase.CreatePlatformContext(connectionString);
        var tenant = new Tenant
        {
            Name = $"WPC Tenant {suffix}",
            DisplayName = $"WPC Tenant {suffix}",
            Slug = $"wpc-{suffix}-{Guid.NewGuid():N}",
            Status = TenantStatus.Active
        };
        var user = new User
        {
            DisplayName = "WPC Owner",
            Email = $"wpc-{suffix}-{Guid.NewGuid():N}@example.test",
            NormalizedEmail = $"WPC-{suffix}-{Guid.NewGuid():N}@EXAMPLE.TEST",
            PasswordHash = "test-hash",
            Status = UserStatus.Active,
            SystemRole = SystemRole.NormalUser
        };
        context.Tenants.Add(tenant);
        context.Users.Add(user);
        context.TenantUsers.Add(new TenantUser
        {
            TenantId = tenant.Id,
            UserId = user.Id,
            Role = TenantUserRole.Owner,
            Status = TenantUserStatus.Active,
            JoinedAt = TestClock.Value
        });
        await context.SaveChangesAsync();
        return new AuthorityGraph(tenant.Id, tenant.Slug, user.Id);
    }

    private static async Task<PlanningAccessGraph> SeedPlanningAccessGraphAsync(string connectionString)
    {
        await using var context = PostgreSqlMigrationTestDatabase.CreatePlatformContext(connectionString);
        var tenant = new Tenant
        {
            Name = "WPC Draft Tenant",
            DisplayName = "WPC Draft Tenant",
            Slug = $"wpc-draft-{Guid.NewGuid():N}",
            Status = TenantStatus.Active
        };
        var owner = NewUser("draft-owner", SystemRole.NormalUser);
        var ordinary = NewUser("draft-ordinary", SystemRole.NormalUser);
        var systemAdmin = NewUser("draft-system-admin", SystemRole.SystemAdmin);
        var workspace = new Workspace
        {
            TenantId = tenant.Id,
            Name = "Draft Workspace",
            Slug = $"draft-workspace-{Guid.NewGuid():N}",
            Status = WorkspaceStatus.Active,
            CreatedByUserId = owner.Id
        };
        var group = new Group
        {
            TenantId = tenant.Id,
            WorkspaceId = workspace.Id,
            Name = "Draft Group",
            Slug = $"draft-group-{Guid.NewGuid():N}",
            Status = GroupStatus.Active,
            CreatedByUserId = owner.Id
        };
        var project = new Project
        {
            TenantId = tenant.Id,
            WorkspaceId = workspace.Id,
            GroupId = group.Id,
            OwnerUserId = owner.Id,
            CreatedByUserId = owner.Id,
            Name = "WPC protected draft",
            Slug = $"wpc-protected-draft-{Guid.NewGuid():N}",
            Status = ProjectStatus.Planning
        };
        var task = new TaskItem
        {
            TenantId = tenant.Id,
            WorkspaceId = workspace.Id,
            ProjectId = project.Id,
            CreatedByUserId = owner.Id,
            PrimaryAssigneeUserId = ordinary.Id,
            Title = "WPC protected draft task"
        };
        var artifact = new Artifact
        {
            TenantId = tenant.Id,
            ProjectId = project.Id,
            TaskItemId = task.Id,
            CreatedByUserId = owner.Id,
            Name = "WPC protected draft artifact"
        };
        var activityLog = new ActivityLog
        {
            TenantId = tenant.Id,
            ProjectId = project.Id,
            TaskItemId = task.Id,
            AuthorUserId = owner.Id,
            ActivityType = ActivityLogType.Note,
            Body = "WPC protected draft activity",
            OccurredAt = TestClock.Value
        };
        var comment = new Comment
        {
            TenantId = tenant.Id,
            WorkspaceId = workspace.Id,
            AuthorUserId = owner.Id,
            TargetType = CommentTargetType.Project,
            TargetId = project.Id,
            Body = "WPC protected draft comment"
        };
        var conversation = new Conversation
        {
            TenantId = tenant.Id,
            WorkspaceId = workspace.Id,
            ProjectId = project.Id,
            Type = ConversationType.ProjectChannel,
            Title = "WPC protected draft conversation",
            CreatedByUserId = owner.Id
        };
        var message = new Message
        {
            TenantId = tenant.Id,
            WorkspaceId = workspace.Id,
            ConversationId = conversation.Id,
            AuthorUserId = owner.Id,
            Body = "WPC protected draft message"
        };
        context.AddRange(
            tenant,
            owner,
            ordinary,
            systemAdmin,
            new TenantUser { TenantId = tenant.Id, UserId = owner.Id, Role = TenantUserRole.Owner, Status = TenantUserStatus.Active, JoinedAt = TestClock.Value },
            new TenantUser { TenantId = tenant.Id, UserId = ordinary.Id, Role = TenantUserRole.Member, Status = TenantUserStatus.Active, JoinedAt = TestClock.Value },
            new TenantUser { TenantId = tenant.Id, UserId = systemAdmin.Id, Role = TenantUserRole.Member, Status = TenantUserStatus.Active, JoinedAt = TestClock.Value },
            workspace,
            new WorkspaceMember { TenantId = tenant.Id, WorkspaceId = workspace.Id, UserId = owner.Id, Role = WorkspaceRole.Owner, Status = MembershipStatus.Active, JoinedAt = TestClock.Value },
            new WorkspaceMember { TenantId = tenant.Id, WorkspaceId = workspace.Id, UserId = ordinary.Id, Role = WorkspaceRole.Admin, Status = MembershipStatus.Active, JoinedAt = TestClock.Value },
            group,
            new GroupMember { TenantId = tenant.Id, GroupId = group.Id, UserId = ordinary.Id, Role = GroupRole.Admin, JoinedAt = TestClock.Value },
            project,
            new ProjectMember { TenantId = tenant.Id, ProjectId = project.Id, UserId = owner.Id, Role = ProjectRole.Owner, JoinedAt = TestClock.Value },
            task,
            artifact,
            activityLog,
            comment,
            conversation,
            new ConversationMember
            {
                TenantId = tenant.Id,
                ConversationId = conversation.Id,
                UserId = owner.Id,
                Role = ConversationMemberRole.Admin,
                JoinedAt = TestClock.Value
            },
            new ConversationMember
            {
                TenantId = tenant.Id,
                ConversationId = conversation.Id,
                UserId = ordinary.Id,
                Role = ConversationMemberRole.Member,
                JoinedAt = TestClock.Value
            },
            message);
        await context.SaveChangesAsync();
        return new PlanningAccessGraph(
            tenant.Id,
            tenant.Slug,
            workspace.Id,
            project.Id,
            task.Id,
            artifact.Id,
            activityLog.Id,
            comment.Id,
            conversation.Id,
            message.Id,
            owner.Id,
            ordinary.Id,
            systemAdmin.Id);
    }

    private static async Task<ActiveVisibilityGraph> SeedActiveVisibilityGraphAsync(string connectionString)
    {
        await using var context = PostgreSqlMigrationTestDatabase.CreatePlatformContext(connectionString);
        var tenant = new Tenant
        {
            Name = "WPC Project visibility tenant",
            DisplayName = "WPC Project visibility tenant",
            Slug = $"wpc-project-visibility-{Guid.NewGuid():N}",
            Status = TenantStatus.Active
        };
        var explicitProjectMember = NewUser("visibility-project-member", SystemRole.NormalUser);
        var groupMember = NewUser("visibility-group-member", SystemRole.NormalUser);
        var workspaceOwner = NewUser("visibility-workspace-owner", SystemRole.NormalUser);
        var workspaceAdmin = NewUser("visibility-workspace-admin", SystemRole.NormalUser);
        var ordinaryWorkspaceMember = NewUser("visibility-ordinary-member", SystemRole.NormalUser);
        var adviser = NewUser("visibility-adviser", SystemRole.NormalUser);
        var ownerFieldOnly = NewUser("visibility-owner-field-only", SystemRole.NormalUser);
        var systemAdmin = NewUser("visibility-system-admin", SystemRole.SystemAdmin);
        var revokedWorkspaceMember = NewUser("visibility-revoked-member", SystemRole.NormalUser);
        var allUsers = new[]
        {
            explicitProjectMember,
            groupMember,
            workspaceOwner,
            workspaceAdmin,
            ordinaryWorkspaceMember,
            adviser,
            ownerFieldOnly,
            systemAdmin,
            revokedWorkspaceMember
        };
        var workspace = new Workspace
        {
            TenantId = tenant.Id,
            Name = "WPC Project visibility workspace",
            Slug = $"wpc-project-visibility-workspace-{Guid.NewGuid():N}",
            Status = WorkspaceStatus.Active,
            CreatedByUserId = workspaceOwner.Id
        };
        var group = new Group
        {
            TenantId = tenant.Id,
            WorkspaceId = workspace.Id,
            Name = "WPC Project visibility group",
            Slug = $"wpc-project-visibility-group-{Guid.NewGuid():N}",
            Status = GroupStatus.Active,
            CreatedByUserId = workspaceOwner.Id
        };

        const string groupedNeedle = "WpcParityGroupedNeedle";
        var groupedProject = NewActiveProjectResourceGraph(
            tenant.Id,
            workspace.Id,
            group.Id,
            ownerFieldOnly.Id,
            workspaceOwner.Id,
            ordinaryWorkspaceMember.Id,
            groupedNeedle);
        const string ungroupedNeedle = "WpcParityUngroupedNeedle";
        var ungroupedProject = NewActiveProjectResourceGraph(
            tenant.Id,
            workspace.Id,
            null,
            workspaceOwner.Id,
            workspaceOwner.Id,
            ordinaryWorkspaceMember.Id,
            ungroupedNeedle);
        var adviserTask = new TaskItem
        {
            TenantId = tenant.Id,
            WorkspaceId = workspace.Id,
            ProjectId = groupedProject.Project.Id,
            PrimaryAssigneeUserId = adviser.Id,
            CreatedByUserId = workspaceOwner.Id,
            Title = $"{groupedNeedle} adviser-only assignment"
        };
        var ownerFieldTask = new TaskItem
        {
            TenantId = tenant.Id,
            WorkspaceId = workspace.Id,
            ProjectId = groupedProject.Project.Id,
            PrimaryAssigneeUserId = ownerFieldOnly.Id,
            CreatedByUserId = workspaceOwner.Id,
            Title = $"{groupedNeedle} owner-field-only assignment"
        };

        context.Add(tenant);
        context.Users.AddRange(allUsers);
        context.TenantUsers.AddRange(allUsers.Select(user => new TenantUser
        {
            TenantId = tenant.Id,
            UserId = user.Id,
            Role = user.Id == workspaceOwner.Id ? TenantUserRole.Owner : TenantUserRole.Member,
            Status = TenantUserStatus.Active,
            JoinedAt = TestClock.Value
        }));
        context.Workspaces.Add(workspace);
        context.WorkspaceMembers.AddRange(
            new WorkspaceMember { TenantId = tenant.Id, WorkspaceId = workspace.Id, UserId = explicitProjectMember.Id, Role = WorkspaceRole.Member, Status = MembershipStatus.Active, JoinedAt = TestClock.Value },
            new WorkspaceMember { TenantId = tenant.Id, WorkspaceId = workspace.Id, UserId = groupMember.Id, Role = WorkspaceRole.Member, Status = MembershipStatus.Active, JoinedAt = TestClock.Value },
            new WorkspaceMember { TenantId = tenant.Id, WorkspaceId = workspace.Id, UserId = workspaceOwner.Id, Role = WorkspaceRole.Owner, Status = MembershipStatus.Active, JoinedAt = TestClock.Value },
            new WorkspaceMember { TenantId = tenant.Id, WorkspaceId = workspace.Id, UserId = workspaceAdmin.Id, Role = WorkspaceRole.Admin, Status = MembershipStatus.Active, JoinedAt = TestClock.Value },
            new WorkspaceMember { TenantId = tenant.Id, WorkspaceId = workspace.Id, UserId = ordinaryWorkspaceMember.Id, Role = WorkspaceRole.Member, Status = MembershipStatus.Active, JoinedAt = TestClock.Value },
            new WorkspaceMember { TenantId = tenant.Id, WorkspaceId = workspace.Id, UserId = adviser.Id, Role = WorkspaceRole.Adviser, Status = MembershipStatus.Active, JoinedAt = TestClock.Value },
            new WorkspaceMember { TenantId = tenant.Id, WorkspaceId = workspace.Id, UserId = ownerFieldOnly.Id, Role = WorkspaceRole.Member, Status = MembershipStatus.Active, JoinedAt = TestClock.Value },
            new WorkspaceMember { TenantId = tenant.Id, WorkspaceId = workspace.Id, UserId = revokedWorkspaceMember.Id, Role = WorkspaceRole.Member, Status = MembershipStatus.Suspended, JoinedAt = TestClock.Value });
        context.Groups.Add(group);
        context.GroupMembers.AddRange(
            new GroupMember { TenantId = tenant.Id, GroupId = group.Id, UserId = groupMember.Id, Role = GroupRole.Member, JoinedAt = TestClock.Value },
            new GroupMember { TenantId = tenant.Id, GroupId = group.Id, UserId = revokedWorkspaceMember.Id, Role = GroupRole.Member, JoinedAt = TestClock.Value });
        context.Projects.AddRange(groupedProject.Project, ungroupedProject.Project);
        context.ProjectMembers.AddRange(
            new ProjectMember { TenantId = tenant.Id, ProjectId = groupedProject.Project.Id, UserId = explicitProjectMember.Id, Role = ProjectRole.Viewer, JoinedAt = TestClock.Value },
            new ProjectMember { TenantId = tenant.Id, ProjectId = groupedProject.Project.Id, UserId = revokedWorkspaceMember.Id, Role = ProjectRole.Viewer, JoinedAt = TestClock.Value });
        context.TaskItems.AddRange(groupedProject.Task, ungroupedProject.Task, adviserTask, ownerFieldTask);
        context.Artifacts.AddRange(groupedProject.Artifact, ungroupedProject.Artifact);
        context.ActivityLogs.AddRange(groupedProject.ActivityLog, ungroupedProject.ActivityLog);
        context.Comments.AddRange(groupedProject.Comment, ungroupedProject.Comment);
        context.Conversations.AddRange(groupedProject.Conversation, ungroupedProject.Conversation);
        context.ConversationMembers.AddRange(allUsers.Select(user => new ConversationMember
        {
            TenantId = tenant.Id,
            ConversationId = groupedProject.Conversation.Id,
            UserId = user.Id,
            Role = ConversationMemberRole.Member,
            CanRead = true,
            JoinedAt = TestClock.Value
        }));
        context.ConversationMembers.Add(new ConversationMember
        {
            TenantId = tenant.Id,
            ConversationId = ungroupedProject.Conversation.Id,
            UserId = ordinaryWorkspaceMember.Id,
            Role = ConversationMemberRole.Member,
            CanRead = true,
            JoinedAt = TestClock.Value
        });
        context.Messages.AddRange(groupedProject.Message, ungroupedProject.Message);
        await context.SaveChangesAsync();

        return new ActiveVisibilityGraph(
            tenant.Id,
            tenant.Slug,
            workspace.Id,
            groupedProject.ToIds(),
            ungroupedProject.ToIds(),
            explicitProjectMember.Id,
            groupMember.Id,
            workspaceOwner.Id,
            workspaceAdmin.Id,
            ordinaryWorkspaceMember.Id,
            adviser.Id,
            ownerFieldOnly.Id,
            systemAdmin.Id,
            revokedWorkspaceMember.Id,
            adviserTask.Id,
            ownerFieldTask.Id);
    }

    private static MutableProjectResourceGraph NewActiveProjectResourceGraph(
        Guid tenantId,
        Guid workspaceId,
        Guid? groupId,
        Guid ownerUserId,
        Guid createdByUserId,
        Guid primaryAssigneeUserId,
        string needle)
    {
        var project = new Project
        {
            TenantId = tenantId,
            WorkspaceId = workspaceId,
            GroupId = groupId,
            OwnerUserId = ownerUserId,
            CreatedByUserId = createdByUserId,
            Name = $"{needle} Project",
            Slug = $"{needle.ToLowerInvariant()}-{Guid.NewGuid():N}",
            Description = $"{needle} protected description",
            Status = ProjectStatus.Active
        };
        var task = new TaskItem
        {
            TenantId = tenantId,
            WorkspaceId = workspaceId,
            ProjectId = project.Id,
            PrimaryAssigneeUserId = primaryAssigneeUserId,
            CreatedByUserId = createdByUserId,
            Title = $"{needle} Task",
            Description = $"{needle} protected task body"
        };
        var artifact = new Artifact
        {
            TenantId = tenantId,
            ProjectId = project.Id,
            TaskItemId = task.Id,
            CreatedByUserId = createdByUserId,
            Name = $"{needle} Artifact",
            Description = $"{needle} protected artifact metadata"
        };
        var activityLog = new ActivityLog
        {
            TenantId = tenantId,
            ProjectId = project.Id,
            TaskItemId = task.Id,
            AuthorUserId = createdByUserId,
            ActivityType = ActivityLogType.Note,
            Body = $"{needle} protected activity",
            OccurredAt = TestClock.Value
        };
        var comment = new Comment
        {
            TenantId = tenantId,
            WorkspaceId = workspaceId,
            AuthorUserId = createdByUserId,
            TargetType = CommentTargetType.Project,
            TargetId = project.Id,
            Body = $"{needle} protected comment"
        };
        var conversation = new Conversation
        {
            TenantId = tenantId,
            WorkspaceId = workspaceId,
            ProjectId = project.Id,
            Type = ConversationType.ProjectChannel,
            Title = $"{needle} Project Channel",
            CreatedByUserId = createdByUserId
        };
        var message = new Message
        {
            TenantId = tenantId,
            WorkspaceId = workspaceId,
            ConversationId = conversation.Id,
            AuthorUserId = createdByUserId,
            Body = $"{needle} protected message"
        };
        return new MutableProjectResourceGraph(
            project,
            task,
            artifact,
            activityLog,
            comment,
            conversation,
            message,
            needle);
    }

    private static User NewUser(string prefix, SystemRole role) => new()
    {
        DisplayName = prefix,
        Email = $"{prefix}-{Guid.NewGuid():N}@example.test",
        NormalizedEmail = $"{prefix}-{Guid.NewGuid():N}@example.test".ToUpperInvariant(),
        PasswordHash = "test-hash",
        Status = UserStatus.Active,
        SystemRole = role
    };

    private static ServiceScope CreateServiceScope(
        string connectionString,
        AuthorityGraph graph,
        IAuthorizationStateChangePublisher? authorizationChanges = null,
        IWorkspaceRequiredInitialization? requiredInitialization = null)
    {
        var currentTenant = new CurrentTenantService();
        currentTenant.SetTenant(graph.TenantId, graph.TenantSlug);
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(connectionString)
            .Options;
        var db = new AppDbContext(options, currentTenant);
        var users = new UserRepository(db);
        var workspaces = new WorkspaceRepository(db);
        var currentUser = new TestCurrentUser(graph.UserId);
        var clock = new TestClock();
        var publisher = authorizationChanges ?? new AuthorizationStateChangePublisher(
            new TransactionalOutbox(new OutboxEventRepository(db), currentTenant, clock),
            currentTenant,
            clock);
        var service = new WorkspaceService(
            workspaces,
            users,
            new WorkspaceAuthorizationService(
                users,
                workspaces,
                new TenantAuthorizationService(new TenantRepository(db))),
            currentUser,
            clock,
            new DbAuditLogger(db, clock, currentUser, currentTenant),
            new EfUnitOfWork(db),
            currentTenant,
            publisher,
            new EfCreateIdempotencyCoordinator(db),
            requiredInitialization ?? new NoopRequiredInitializationForCoordinatorTests());
        return new ServiceScope(db, service);
    }

    private static AppDbContext CreateTenantContext(
        string connectionString,
        Guid tenantId,
        string tenantSlug)
    {
        var currentTenant = new CurrentTenantService();
        currentTenant.SetTenant(tenantId, tenantSlug);
        return new AppDbContext(
            new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(connectionString).Options,
            currentTenant);
    }

    private static Task<bool> TableExistsAsync(string connectionString, string table) =>
        PostgreSqlMigrationTestDatabase.ScalarAsync<bool>(
            connectionString,
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = @table);",
            ("table", table));

    private static Task<bool> ColumnExistsAsync(string connectionString, string table, string column) =>
        PostgreSqlMigrationTestDatabase.ScalarAsync<bool>(
            connectionString,
            "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = @table AND column_name = @column);",
            ("table", table),
            ("column", column));

    private static Task<bool> IndexExistsAsync(string connectionString, string index) =>
        PostgreSqlMigrationTestDatabase.ScalarAsync<bool>(
            connectionString,
            "SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = @index);",
            ("index", index));

    private sealed record AuthorityGraph(Guid TenantId, string TenantSlug, Guid UserId);

    private sealed record PlanningAccessGraph(
        Guid TenantId,
        string TenantSlug,
        Guid WorkspaceId,
        Guid ProjectId,
        Guid TaskId,
        Guid ArtifactId,
        Guid ActivityLogId,
        Guid CommentId,
        Guid ConversationId,
        Guid MessageId,
        Guid OwnerUserId,
        Guid OrdinaryUserId,
        Guid SystemAdminUserId);

    private sealed record ProjectReadExpectation(
        string Label,
        Guid UserId,
        SystemRole SystemRole,
        bool Expected);

    private sealed record ProjectResourceGraph(
        Guid WorkspaceId,
        Guid ProjectId,
        Guid TaskId,
        Guid ArtifactId,
        Guid ActivityLogId,
        Guid CommentId,
        Guid ConversationId,
        Guid MessageId,
        string Needle);

    private sealed record MutableProjectResourceGraph(
        Project Project,
        TaskItem Task,
        Artifact Artifact,
        ActivityLog ActivityLog,
        Comment Comment,
        Conversation Conversation,
        Message Message,
        string Needle)
    {
        public ProjectResourceGraph ToIds() => new(
            Project.WorkspaceId,
            Project.Id,
            Task.Id,
            Artifact.Id,
            ActivityLog.Id,
            Comment.Id,
            Conversation.Id,
            Message.Id,
            Needle);
    }

    private sealed record ActiveVisibilityGraph(
        Guid TenantId,
        string TenantSlug,
        Guid WorkspaceId,
        ProjectResourceGraph GroupedProject,
        ProjectResourceGraph UngroupedProject,
        Guid ExplicitProjectMemberUserId,
        Guid GroupMemberUserId,
        Guid WorkspaceOwnerUserId,
        Guid WorkspaceAdminUserId,
        Guid OrdinaryWorkspaceMemberUserId,
        Guid AdviserUserId,
        Guid OwnerFieldOnlyUserId,
        Guid SystemAdminUserId,
        Guid RevokedWorkspaceMemberUserId,
        Guid AdviserTaskId,
        Guid OwnerFieldTaskId);

    private sealed record ServiceScope(AppDbContext Db, WorkspaceService Service) : IAsyncDisposable
    {
        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }

    private sealed class TestCurrentUser(
        Guid userId,
        SystemRole systemRole = AipPortal.Domain.Enums.SystemRole.NormalUser) : ICurrentUser
    {
        public Guid? UserId => userId;
        public Guid? SessionId => Guid.NewGuid();
        public string? Email => "wpc-owner@example.test";
        public SystemRole? SystemRole => systemRole;
        public bool IsAuthenticated => true;
    }

    private sealed class TestClock : IClock
    {
        public static DateTimeOffset Value { get; } = new(2026, 8, 13, 0, 0, 0, TimeSpan.Zero);
        public DateTimeOffset UtcNow => Value;
    }

    private sealed class NoopRequiredInitializationForCoordinatorTests : IWorkspaceRequiredInitialization
    {
        public bool IsAvailable => true;

        public Task<Result> StageAsync(
            Workspace workspace,
            Guid creatorUserId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(Result.Success());
    }

    private sealed class FailingRequiredInitialization : IWorkspaceRequiredInitialization
    {
        public bool IsAvailable => true;

        public Task<Result> StageAsync(
            Workspace workspace,
            Guid creatorUserId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(Result.Failure("Canonical general provisioning failed."));
    }
}
