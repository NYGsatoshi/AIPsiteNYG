using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Application.Groups;
using AipPortal.Application.Notifications;
using AipPortal.Application.Projects;
using AipPortal.Application.Realtime;
using AipPortal.Application.Security.Redaction;
using AipPortal.Application.Tenancy;
using AipPortal.Application.Workspaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Audit;
using AipPortal.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Tests.PostgreSql;

[Collection("PostgreSqlTaskV1")]
[Trait("Category", "PostgreSQLIntegration")]
[Trait("Scope", "WPCFINAL01")]
public sealed class WpcFinal01IntegratedAcceptancePostgreSqlTests
{
    private static readonly DateTimeOffset Now =
        new(2026, 8, 21, 10, 0, 0, TimeSpan.Zero);

    [PostgreSqlFact]
    public async Task CanonicalWorkspaceProjectActivationArchiveRecoveryNotificationAndReauthorizationJourney()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();

        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedAuthorityAsync(database);

            Guid workspaceId;
            await using (var workspaceScope = CreateWorkspaceScope(database, graph, graph.OwnerUserId))
            {
                var create = await workspaceScope.Service.CreateAsync(
                    new CreateWorkspaceRequest(
                        "WPC Final Workspace",
                        "Fresh PostgreSQL integrated acceptance",
                        null),
                    "wpc-final01-workspace-create");
                Assert.True(create.IsSuccess, create.Error);
                workspaceId = create.Value!.Id;

                var addMember = await workspaceScope.Service.AddMemberAsync(
                    workspaceId,
                    new AddWorkspaceMemberRequest(graph.DelegatedUserId, WorkspaceRole.Member));
                Assert.True(addMember.IsSuccess, addMember.Error);
            }

            Guid workspaceGeneralId;
            await using (var verification = CreateTenantContext(database, graph))
            {
                var workspace = await verification.Workspaces.SingleAsync(item => item.Id == workspaceId);
                Assert.Equal(WorkspaceStatus.Active, workspace.Status);

                var ownerMembership = await verification.WorkspaceMembers.SingleAsync(item =>
                    item.WorkspaceId == workspaceId &&
                    item.UserId == graph.OwnerUserId);
                Assert.Equal(WorkspaceRole.Owner, ownerMembership.Role);
                Assert.Equal(MembershipStatus.Active, ownerMembership.Status);

                var delegatedMembership = await verification.WorkspaceMembers.SingleAsync(item =>
                    item.WorkspaceId == workspaceId &&
                    item.UserId == graph.DelegatedUserId);
                Assert.Equal(WorkspaceRole.Member, delegatedMembership.Role);
                Assert.Equal(MembershipStatus.Active, delegatedMembership.Status);

                var workspaceGeneral = await verification.Conversations.SingleAsync(item =>
                    item.WorkspaceId == workspaceId &&
                    item.ProjectId == null &&
                    item.DefaultKind == ConversationDefaultKind.WorkspaceGeneral);
                workspaceGeneralId = workspaceGeneral.Id;
                Assert.Equal(ConversationType.WorkspaceChannel, workspaceGeneral.Type);
                Assert.Equal("general", workspaceGeneral.Title);
                Assert.Equal(ConversationVisibility.PublicWithinScope, workspaceGeneral.Visibility);

                var ownerParticipant = await verification.ConversationMembers.SingleAsync(item =>
                    item.ConversationId == workspaceGeneral.Id &&
                    item.UserId == graph.OwnerUserId);
                Assert.Equal(ConversationMemberRole.Admin, ownerParticipant.Role);
                Assert.True(ownerParticipant.CanRead);
                Assert.True(ownerParticipant.CanPost);
                Assert.True(ownerParticipant.CanManageMembers);

                var delegatedParticipant = await verification.ConversationMembers.SingleAsync(item =>
                    item.ConversationId == workspaceGeneral.Id &&
                    item.UserId == graph.DelegatedUserId);
                Assert.Equal(ConversationMemberRole.Member, delegatedParticipant.Role);
                Assert.True(delegatedParticipant.CanRead);
                Assert.True(delegatedParticipant.CanPost);
                Assert.False(delegatedParticipant.CanManageMembers);
            }

            Guid projectCreateGrantId;
            Guid visibilityGrantId;
            await using (var capabilityScope = CreateCapabilityScope(database, graph, graph.OwnerUserId))
            {
                var createGrant = await capabilityScope.Service.GrantAsync(
                    new GrantCapabilityRequest(
                        graph.DelegatedUserId,
                        CapabilityKeys.ProjectCreate,
                        CapabilityScopeType.Workspace,
                        workspaceId,
                        Now.AddHours(4)));
                Assert.True(createGrant.IsSuccess, createGrant.Error);
                projectCreateGrantId = createGrant.Value!.Id;

                var visibilityGrant = await capabilityScope.Service.GrantAsync(
                    new GrantCapabilityRequest(
                        graph.DelegatedUserId,
                        CapabilityKeys.ProjectVisibilityManage,
                        CapabilityScopeType.Workspace,
                        workspaceId,
                        Now.AddHours(4)));
                Assert.True(visibilityGrant.IsSuccess, visibilityGrant.Error);
                visibilityGrantId = visibilityGrant.Value!.Id;
            }

            Guid projectId;
            long projectVersion;
            await using (var projectCreateScope = CreateProjectCreateScope(
                             database,
                             graph,
                             graph.DelegatedUserId))
            {
                var create = await projectCreateScope.Service.CreateAsync(
                    workspaceId,
                    new CanonicalCreateProjectRequest(
                        "WPC Final Project",
                        "Canonical delegated Project create",
                        Visibility: ProjectVisibility.WorkspaceVisible),
                    "wpc-final01-project-create");
                Assert.True(create.IsSuccess, create.Error);
                Assert.Equal(ProjectStatus.Planning, create.Value!.Status);
                Assert.Equal(ProjectVisibility.WorkspaceVisible, create.Value.Visibility);
                Assert.Equal(ProjectActivationState.NeverActivated, create.Value.ActivationState);
                Assert.Equal(graph.DelegatedUserId, create.Value.OwnerUserId);

                projectId = create.Value.Id;
                projectVersion = create.Value.VersionNo;
            }

            await using (var verification = CreateTenantContext(database, graph))
            {
                Assert.Equal(0, await verification.Conversations.CountAsync(item =>
                    item.ProjectId == projectId &&
                    item.DefaultKind == ConversationDefaultKind.ProjectGeneral));
                Assert.Equal(0, await verification.TaskWorkflowDefinitions.CountAsync(item =>
                    item.ProjectId == projectId));
                Assert.Equal(0, await verification.TaskWorkflowStages.CountAsync(item =>
                    item.ProjectId == projectId));
            }

            await using (var activationScope = CreateActivationScope(
                             database,
                             graph,
                             graph.DelegatedUserId))
            {
                var activation = await activationScope.Service.ActivateAsync(projectId, projectVersion);
                Assert.True(activation.IsSuccess, activation.Error);
            }

            Guid projectGeneralId;
            await using (var verification = CreateTenantContext(database, graph))
            {
                var project = await verification.Projects.SingleAsync(item => item.Id == projectId);
                Assert.Equal(ProjectStatus.Active, project.Status);
                Assert.Equal(ProjectActivationState.Activated, project.ActivationState);
                Assert.Equal(Now, project.ActivatedAtUtc);
                Assert.Equal(ProjectActivationService.CanonicalActivationVersion, project.ActivationVersion);
                Assert.True(project.VersionNo > projectVersion);

                var projectGeneral = await verification.Conversations.SingleAsync(item =>
                    item.ProjectId == projectId &&
                    item.DefaultKind == ConversationDefaultKind.ProjectGeneral);
                projectGeneralId = projectGeneral.Id;
                Assert.Equal(ConversationType.ProjectChannel, projectGeneral.Type);
                Assert.Equal("general", projectGeneral.Title);
                Assert.Equal(ConversationVisibility.PublicWithinScope, projectGeneral.Visibility);

                var projectParticipant = await verification.ConversationMembers.SingleAsync(item =>
                    item.ConversationId == projectGeneral.Id &&
                    item.UserId == graph.DelegatedUserId);
                Assert.Equal(ConversationMemberRole.Admin, projectParticipant.Role);
                Assert.True(projectParticipant.CanRead);
                Assert.True(projectParticipant.CanPost);
                Assert.True(projectParticipant.CanManageMembers);

                var definition = await verification.TaskWorkflowDefinitions.SingleAsync(item =>
                    item.ProjectId == projectId);
                Assert.Equal("Default", definition.Name);
                Assert.True(definition.ReviewEnforcementEnabled);

                var stageNames = await verification.TaskWorkflowStages
                    .Where(item => item.ProjectId == projectId)
                    .OrderBy(item => item.SortKey)
                    .Select(item => item.Name)
                    .ToListAsync();
                Assert.Equal(
                    new[] { "Backlog", "Todo", "In Progress", "Review", "Done", "Cancelled" },
                    stageNames);
            }

            await AssertNestedProjectRecoveryAsync(database, graph, projectId);

            var targets = await SeedNotificationTargetsAsync(
                database,
                graph,
                workspaceId,
                projectId,
                projectGeneralId);

            await using (var notificationScope = CreateNotificationScope(database, graph))
            {
                var artifactOpen = await notificationScope.Service.OpenAsync(
                    graph.TenantId,
                    graph.DelegatedUserId,
                    targets.ArtifactNotificationId);
                Assert.True(artifactOpen.IsOwned);
                Assert.True(artifactOpen.IsAvailable);
                Assert.Equal($"/artifacts/{targets.ArtifactId}", artifactOpen.Route);
                Assert.Equal(workspaceId, artifactOpen.WorkspaceId);

                var messageOpen = await notificationScope.Service.OpenAsync(
                    graph.TenantId,
                    graph.DelegatedUserId,
                    targets.MessageNotificationId);
                Assert.True(messageOpen.IsOwned);
                Assert.True(messageOpen.IsAvailable);
                Assert.Equal(
                    $"/conversations/{projectGeneralId}?messageId={targets.MessageId}",
                    messageOpen.Route);
                Assert.Equal(workspaceId, messageOpen.WorkspaceId);
            }

            await using (var workspaceScope = CreateWorkspaceScope(database, graph, graph.OwnerUserId))
            {
                var archive = await workspaceScope.Service.ArchiveAsync(workspaceId);
                Assert.True(archive.IsSuccess, archive.Error);
            }

            await using (var archivedCreateScope = CreateProjectCreateScope(
                             database,
                             graph,
                             graph.DelegatedUserId))
            {
                var archivedCreate = await archivedCreateScope.Service.CreateAsync(
                    workspaceId,
                    new CanonicalCreateProjectRequest("Must not create while archived"),
                    "wpc-final01-archived-create");
                Assert.False(archivedCreate.IsSuccess);
                Assert.Equal("InvalidStateTransition", archivedCreate.ErrorDetail?.Code);
                Assert.Equal("workspace.status", archivedCreate.ErrorDetail?.Target);
            }

            await using (var workspaceScope = CreateWorkspaceScope(database, graph, graph.OwnerUserId))
            {
                var restore = await workspaceScope.Service.RestoreAsync(workspaceId);
                Assert.True(restore.IsSuccess, restore.Error);
            }

            var redaction = new CanonicalRedactionService().Redact(
                new AuthorizationContext(
                    ActorId: graph.DelegatedUserId,
                    TenantId: graph.TenantId,
                    ModuleKey: "WpcFinal01",
                    Purpose: RedactionPurpose.NormalOperation,
                    RequestId: "wpc-final01-redaction",
                    AuthorizationState: RedactionAuthorizationState.Denied),
                new
                {
                    Body = "must-not-cross-the-response-boundary",
                    Message = "safe notification shell"
                },
                RedactionProfile.NotificationPayload);
            Assert.True(redaction.RedactionApplied);
            Assert.IsType<RedactedPayload>(redaction.Value);

            await using (var capabilityScope = CreateCapabilityScope(database, graph, graph.OwnerUserId))
            {
                var revokeCreate = await capabilityScope.Service.RevokeAsync(projectCreateGrantId);
                Assert.True(revokeCreate.IsSuccess, revokeCreate.Error);

                var revokeVisibility = await capabilityScope.Service.RevokeAsync(visibilityGrantId);
                Assert.True(revokeVisibility.IsSuccess, revokeVisibility.Error);
            }

            await using (var revokedCapabilityCreateScope = CreateProjectCreateScope(
                             database,
                             graph,
                             graph.DelegatedUserId))
            {
                var denied = await revokedCapabilityCreateScope.Service.CreateAsync(
                    workspaceId,
                    new CanonicalCreateProjectRequest("Must not create after capability revocation"),
                    "wpc-final01-revoked-capability-create");
                Assert.False(denied.IsSuccess);
                Assert.Equal("CapabilityDenied", denied.ErrorDetail?.Code);
            }

            await using (var workspaceScope = CreateWorkspaceScope(database, graph, graph.OwnerUserId))
            {
                var remove = await workspaceScope.Service.RemoveMemberAsync(
                    workspaceId,
                    graph.DelegatedUserId);
                Assert.True(remove.IsSuccess, remove.Error);
            }

            await using (var notificationScope = CreateNotificationScope(database, graph))
            {
                var unavailable = await notificationScope.Service.OpenAsync(
                    graph.TenantId,
                    graph.DelegatedUserId,
                    targets.RevokedMessageNotificationId);
                Assert.True(unavailable.IsOwned);
                Assert.False(unavailable.IsAvailable);
                Assert.Null(unavailable.Route);
                Assert.Null(unavailable.WorkspaceId);
            }

            await using (var removedMemberCreateScope = CreateProjectCreateScope(
                             database,
                             graph,
                             graph.DelegatedUserId))
            {
                var notFound = await removedMemberCreateScope.Service.CreateAsync(
                    workspaceId,
                    new CanonicalCreateProjectRequest("Must not create after membership removal"),
                    "wpc-final01-removed-member-create");
                Assert.False(notFound.IsSuccess);
                Assert.Equal("NotFound", notFound.ErrorDetail?.Code);
            }

            await using (var verification = CreateTenantContext(database, graph))
            {
                Assert.Equal(WorkspaceStatus.Active, await verification.Workspaces
                    .Where(item => item.Id == workspaceId)
                    .Select(item => item.Status)
                    .SingleAsync());
                Assert.Equal(1, await verification.Projects.CountAsync());
                Assert.Equal(2, await verification.IdempotencyRecords.CountAsync());

                var delegatedMembership = await verification.WorkspaceMembers.SingleAsync(item =>
                    item.WorkspaceId == workspaceId &&
                    item.UserId == graph.DelegatedUserId);
                Assert.Equal(MembershipStatus.Suspended, delegatedMembership.Status);

                var workspaceGeneralParticipant = await verification.ConversationMembers.SingleAsync(item =>
                    item.ConversationId == workspaceGeneralId &&
                    item.UserId == graph.DelegatedUserId);
                Assert.False(workspaceGeneralParticipant.CanRead);
                Assert.False(workspaceGeneralParticipant.CanPost);
                Assert.NotNull(workspaceGeneralParticipant.RemovedAt);

                var grants = await verification.Set<CapabilityGrant>()
                    .Where(item => item.Id == projectCreateGrantId || item.Id == visibilityGrantId)
                    .ToListAsync();
                Assert.Equal(2, grants.Count);
                Assert.All(grants, grant =>
                {
                    Assert.NotNull(grant.RevokedAt);
                    Assert.Equal(2L, grant.VersionNo);
                });

                Assert.True((await verification.Notifications.SingleAsync(item =>
                    item.Id == targets.ArtifactNotificationId)).IsRead);
                Assert.True((await verification.Notifications.SingleAsync(item =>
                    item.Id == targets.MessageNotificationId)).IsRead);
                Assert.False((await verification.Notifications.SingleAsync(item =>
                    item.Id == targets.RevokedMessageNotificationId)).IsRead);

                Assert.Equal(2, await verification.OutboxEvents.CountAsync(item =>
                    item.EventType == "Notifications.NotificationReadStateChanged.v1"));
                Assert.Equal(1, await verification.AuditLogs.CountAsync(item =>
                    item.Action == "WorkspaceCreated" &&
                    item.EntityId == workspaceId));
                Assert.Equal(1, await verification.AuditLogs.CountAsync(item =>
                    item.Action == "ProjectCreated" &&
                    item.EntityId == projectId));
                Assert.Equal(1, await verification.AuditLogs.CountAsync(item =>
                    item.Action == "ProjectActivated" &&
                    item.EntityId == projectId));
                Assert.Equal(1, await verification.AuditLogs.CountAsync(item =>
                    item.Action == "WorkspaceArchived" &&
                    item.EntityId == workspaceId));
                Assert.Equal(1, await verification.AuditLogs.CountAsync(item =>
                    item.Action == "WorkspaceRestored" &&
                    item.EntityId == workspaceId));
                Assert.Equal(2, await verification.AuditLogs.CountAsync(item =>
                    item.Action == "CapabilityGranted"));
                Assert.Equal(2, await verification.AuditLogs.CountAsync(item =>
                    item.Action == "CapabilityRevoked"));
                Assert.Equal(1, await verification.AuditLogs.CountAsync(item =>
                    item.Action == "WorkspaceMemberRemoved" &&
                    item.EntityId == workspaceId));
            }
        });
    }

    private static async Task AssertNestedProjectRecoveryAsync(
        string connectionString,
        AuthorityGraph graph,
        Guid projectId)
    {
        await using var db = CreateTenantContext(connectionString, graph);
        var project = await db.Projects.SingleAsync(item => item.Id == projectId);

        project.Status = ProjectStatus.Suspended;
        await db.SaveChangesAsync();
        Assert.Equal(ProjectStatus.Active, project.SuspendedFromStatus);

        project.Status = ProjectStatus.Archived;
        await db.SaveChangesAsync();
        Assert.Equal(ProjectStatus.Suspended, project.ArchivedFromStatus);
        Assert.Equal(ProjectStatus.Active, project.SuspendedFromStatus);

        project.Status = ProjectStatus.Suspended;
        await db.SaveChangesAsync();
        Assert.Null(project.ArchivedFromStatus);
        Assert.Equal(ProjectStatus.Active, project.SuspendedFromStatus);

        project.Status = ProjectStatus.Active;
        await db.SaveChangesAsync();
        Assert.Null(project.SuspendedFromStatus);
        Assert.Null(project.ArchivedFromStatus);
        Assert.Equal(ProjectActivationState.Activated, project.ActivationState);
    }

    private static async Task<AuthorityGraph> SeedAuthorityAsync(string connectionString)
    {
        var suffix = Guid.NewGuid().ToString("N");
        var tenant = new Tenant
        {
            Name = $"WPC Final tenant {suffix}",
            DisplayName = "WPC Final tenant",
            Slug = $"wpc-final-{suffix}",
            Status = TenantStatus.Active
        };
        var owner = NewUser($"wpc-final-owner-{suffix}");
        var delegated = NewUser($"wpc-final-delegated-{suffix}");

        await using var platform = PostgreSqlMigrationTestDatabase.CreatePlatformContext(connectionString);
        platform.AddRange(
            tenant,
            owner,
            delegated,
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
                UserId = delegated.Id,
                Role = TenantUserRole.Member,
                Status = TenantUserStatus.Active,
                JoinedAt = Now
            });
        await platform.SaveChangesAsync();

        return new AuthorityGraph(
            tenant.Id,
            tenant.Slug,
            owner.Id,
            delegated.Id);
    }

    private static async Task<NotificationTargets> SeedNotificationTargetsAsync(
        string connectionString,
        AuthorityGraph graph,
        Guid workspaceId,
        Guid projectId,
        Guid projectGeneralId)
    {
        await using var db = CreateTenantContext(connectionString, graph);
        var artifact = new Artifact
        {
            TenantId = graph.TenantId,
            ProjectId = projectId,
            Name = "WPC Final artifact",
            CreatedByUserId = graph.DelegatedUserId
        };
        var message = new Message
        {
            TenantId = graph.TenantId,
            WorkspaceId = workspaceId,
            ConversationId = projectGeneralId,
            AuthorUserId = graph.DelegatedUserId,
            Body = "WPC Final authorized message"
        };
        var artifactNotification = NewNotification(
            graph,
            NotificationType.ArtifactUploaded,
            "Artifact uploaded",
            "Artifact",
            artifact.Id);
        var messageNotification = NewNotification(
            graph,
            NotificationType.DirectMessage,
            "New message",
            "Message",
            message.Id);
        var revokedMessageNotification = NewNotification(
            graph,
            NotificationType.DirectMessage,
            "Message requiring current authorization",
            "Message",
            message.Id);

        db.AddRange(
            artifact,
            message,
            artifactNotification,
            messageNotification,
            revokedMessageNotification);
        await db.SaveChangesAsync();

        return new NotificationTargets(
            artifact.Id,
            message.Id,
            artifactNotification.Id,
            messageNotification.Id,
            revokedMessageNotification.Id);
    }

    private static Notification NewNotification(
        AuthorityGraph graph,
        NotificationType type,
        string title,
        string relatedEntityType,
        Guid relatedEntityId) => new()
    {
        TenantId = graph.TenantId,
        UserId = graph.DelegatedUserId,
        NotificationType = type,
        Title = title,
        RelatedEntityType = relatedEntityType,
        RelatedEntityId = relatedEntityId,
        CreatedAt = Now,
        StateVersion = 0
    };

    private static User NewUser(string prefix) => new()
    {
        DisplayName = prefix,
        Email = $"{prefix}@example.test".ToLowerInvariant(),
        NormalizedEmail = $"{prefix}@example.test".ToUpperInvariant(),
        PasswordHash = "test-hash",
        Status = UserStatus.Active,
        SystemRole = SystemRole.NormalUser
    };

    private static ServiceScope<WorkspaceService> CreateWorkspaceScope(
        string connectionString,
        AuthorityGraph graph,
        Guid actorUserId)
    {
        var currentTenant = TenantScope(graph);
        var db = new AppDbContext(Options(connectionString), currentTenant);
        var clock = new FixedClock();
        var currentUser = new TestCurrentUser(actorUserId);
        var users = new UserRepository(db);
        var workspaces = new WorkspaceRepository(db);
        var tenants = new TenantRepository(db);
        var capabilityGrants = new CapabilityGrantEvaluator(
            new CapabilityGrantRepository(db),
            tenants,
            workspaces,
            currentTenant,
            clock);
        var outbox = new TransactionalOutbox(
            new OutboxEventRepository(db),
            currentTenant,
            clock);
        var authorizationChanges = new AuthorizationStateChangePublisher(
            outbox,
            currentTenant,
            clock);
        var conversationStore = new DefaultConversationStore(db);
        var service = new WorkspaceService(
            workspaces,
            users,
            new WorkspaceAuthorizationService(
                users,
                workspaces,
                new TenantAuthorizationService(tenants),
                capabilityGrants),
            currentUser,
            clock,
            new DbAuditLogger(db, clock, currentUser, currentTenant),
            new EfUnitOfWork(db),
            currentTenant,
            authorizationChanges,
            new EfCreateIdempotencyCoordinator(db),
            new WorkspaceGeneralRequiredInitialization(
                conversationStore,
                currentTenant,
                clock,
                authorizationChanges),
            new WorkspaceGeneralMembershipSynchronizer(
                conversationStore,
                currentTenant,
                clock,
                authorizationChanges));
        return new ServiceScope<WorkspaceService>(db, service);
    }

    private static ServiceScope<CapabilityGrantService> CreateCapabilityScope(
        string connectionString,
        AuthorityGraph graph,
        Guid actorUserId)
    {
        var currentTenant = TenantScope(graph);
        var db = new AppDbContext(Options(connectionString), currentTenant);
        var clock = new FixedClock();
        var currentUser = new TestCurrentUser(actorUserId);
        var tenants = new TenantRepository(db);
        var workspaces = new WorkspaceRepository(db);
        var outbox = new TransactionalOutbox(
            new OutboxEventRepository(db),
            currentTenant,
            clock);
        var authorizationChanges = new AuthorizationStateChangePublisher(
            outbox,
            currentTenant,
            clock);
        var service = new CapabilityGrantService(
            new CapabilityGrantRepository(db),
            tenants,
            workspaces,
            new TenantAuthorizationService(tenants),
            currentTenant,
            currentUser,
            clock,
            new DbAuditLogger(db, clock, currentUser, currentTenant),
            authorizationChanges,
            new EfUnitOfWork(db));
        return new ServiceScope<CapabilityGrantService>(db, service);
    }

    private static ServiceScope<CanonicalProjectCreateService> CreateProjectCreateScope(
        string connectionString,
        AuthorityGraph graph,
        Guid actorUserId)
    {
        var currentTenant = TenantScope(graph);
        var db = new AppDbContext(Options(connectionString), currentTenant);
        var clock = new FixedClock();
        var currentUser = new TestCurrentUser(actorUserId);
        var projects = new ProjectRepository(db);
        var workspaces = new WorkspaceRepository(db);
        var groups = new GroupRepository(db);
        var tenants = new TenantRepository(db);
        var outbox = new TransactionalOutbox(
            new OutboxEventRepository(db),
            currentTenant,
            clock);
        var authorizationChanges = new AuthorizationStateChangePublisher(
            outbox,
            currentTenant,
            clock);
        var capabilityGrants = new CapabilityGrantEvaluator(
            new CapabilityGrantRepository(db),
            tenants,
            workspaces,
            currentTenant,
            clock);
        var service = new CanonicalProjectCreateService(
            projects,
            workspaces,
            groups,
            tenants,
            capabilityGrants,
            currentUser,
            currentTenant,
            clock,
            new DbAuditLogger(db, clock, currentUser, currentTenant),
            authorizationChanges,
            new EfCreateIdempotencyCoordinator(db));
        return new ServiceScope<CanonicalProjectCreateService>(db, service);
    }

    private static ServiceScope<ProjectActivationService> CreateActivationScope(
        string connectionString,
        AuthorityGraph graph,
        Guid actorUserId)
    {
        var currentTenant = TenantScope(graph);
        var db = new AppDbContext(Options(connectionString), currentTenant);
        var clock = new FixedClock();
        var currentUser = new TestCurrentUser(actorUserId);
        var projects = new ProjectRepository(db);
        var workspaces = new WorkspaceRepository(db);
        var groups = new GroupRepository(db);
        var tenants = new TenantRepository(db);
        var users = new UserRepository(db);
        var tenantAuthorization = new TenantAuthorizationService(tenants);
        var capabilityGrants = new CapabilityGrantEvaluator(
            new CapabilityGrantRepository(db),
            tenants,
            workspaces,
            currentTenant,
            clock);
        var workspaceAuthorization = new WorkspaceAuthorizationService(
            users,
            workspaces,
            tenantAuthorization,
            capabilityGrants);
        var groupAuthorization = new GroupAuthorizationService(
            groups,
            workspaces,
            workspaceAuthorization);
        var projectAuthorization = new ProjectAuthorizationService(
            projects,
            workspaceAuthorization,
            groupAuthorization,
            groups);
        var outbox = new TransactionalOutbox(
            new OutboxEventRepository(db),
            currentTenant,
            clock);
        var authorizationChanges = new AuthorizationStateChangePublisher(
            outbox,
            currentTenant,
            clock);
        var service = new ProjectActivationService(
            projects,
            workspaces,
            tenants,
            projectAuthorization,
            new ProjectGeneralActivationProvisioner(
                new DefaultConversationStore(db),
                projects,
                currentTenant,
                clock,
                authorizationChanges),
            new ProjectTaskWorkflowActivationProvisioner(
                new ProjectActivationWorkflowStore(db),
                new ProjectTaskWorkflowResolver(
                    new NoConfiguredProjectTaskWorkflowSource())),
            new ProjectActivationUnitOfWork(db),
            currentUser,
            currentTenant,
            clock,
            new DbAuditLogger(db, clock, currentUser, currentTenant),
            new BusinessInvalidationPublisher(outbox, currentTenant, clock));
        return new ServiceScope<ProjectActivationService>(db, service);
    }

    private static ServiceScope<NotificationOpenService> CreateNotificationScope(
        string connectionString,
        AuthorityGraph graph)
    {
        var currentTenant = TenantScope(graph);
        var db = new AppDbContext(Options(connectionString), currentTenant);
        var clock = new FixedClock();
        var currentAuthorization = new CurrentAuthorizationTargetResolver(
            db,
            currentTenant,
            new MessagingRepository(db));
        var navigation = new NotificationNavigationTargetResolver(
            db,
            currentAuthorization);
        var outbox = new TransactionalOutbox(
            new OutboxEventRepository(db),
            currentTenant,
            clock);
        var notifications = new DbNotificationService(
            db,
            clock,
            currentTenant,
            targets: navigation);
        var service = new NotificationOpenService(
            db,
            currentTenant,
            clock,
            outbox,
            navigation,
            notifications);
        return new ServiceScope<NotificationOpenService>(db, service);
    }

    private static AppDbContext CreateTenantContext(
        string connectionString,
        AuthorityGraph graph) =>
        new(Options(connectionString), TenantScope(graph));

    private static CurrentTenantService TenantScope(AuthorityGraph graph)
    {
        var currentTenant = new CurrentTenantService();
        currentTenant.SetTenant(graph.TenantId, graph.TenantSlug);
        return currentTenant;
    }

    private static DbContextOptions<AppDbContext> Options(string connectionString) =>
        new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(connectionString)
            .AddInterceptors(new ProjectGovernanceSaveChangesInterceptor())
            .Options;

    private sealed record AuthorityGraph(
        Guid TenantId,
        string TenantSlug,
        Guid OwnerUserId,
        Guid DelegatedUserId);

    private sealed record NotificationTargets(
        Guid ArtifactId,
        Guid MessageId,
        Guid ArtifactNotificationId,
        Guid MessageNotificationId,
        Guid RevokedMessageNotificationId);

    private sealed class FixedClock : IClock
    {
        public DateTimeOffset UtcNow => Now;
    }

    private sealed class TestCurrentUser(Guid userId) : ICurrentUser
    {
        public Guid? UserId { get; } = userId;
        public Guid? SessionId => null;
        public string? Email => "wpc-final01@example.test";
        public SystemRole? SystemRole => AipPortal.Domain.Enums.SystemRole.NormalUser;
        public bool IsAuthenticated => true;
    }

    private sealed class ServiceScope<TService>(
        AppDbContext db,
        TService service) : IAsyncDisposable
        where TService : class
    {
        public AppDbContext Db { get; } = db;
        public TService Service { get; } = service;

        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }
}
