using System.Data.Common;
using System.Text.Json;
using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Application.Notifications;
using AipPortal.Application.Realtime;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace AipPortal.Tests.PostgreSql;

[Trait("Category", "PostgreSQLIntegration")]
[Trait("Scope", "TaskV1PR07C")]
public sealed class TaskV1Pr07CDigestCandidateAtomicityPostgreSqlTests
{
    private static readonly DateTimeOffset Now = new(2026, 8, 3, 4, 30, 0, TimeSpan.Zero);
    private static readonly DateOnly LocalDate = new(2026, 8, 3);

    [PostgreSqlFact]
    public async Task CandidateQueryUsesCurrentEffectiveWatchAndExcludesVisibilityOrTeamQueueAlone()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();

        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedGraphAsync(database);

            await using (var db = CreateTenantContext(database, graph.Tenant))
            {
                var creator = NewTask(graph, "creator", 1);
                creator.CreatedByUserId = graph.Recipient.Id;
                var assignee = NewTask(graph, "primary assignee", 2);
                assignee.PrimaryAssigneeUserId = graph.Recipient.Id;
                var reviewer = NewTask(graph, "reviewer", 3);
                reviewer.ReviewerUserId = graph.Recipient.Id;
                var collaborator = NewTask(graph, "collaborator", 4);
                var manualWatch = NewTask(graph, "manual watch", 5);
                var optedOutCreator = NewTask(graph, "opted-out creator", 6);
                optedOutCreator.CreatedByUserId = graph.Recipient.Id;
                var visibilityOnly = NewTask(graph, "visibility only", 7);
                var teamQueueOnly = NewTask(graph, "team queue only", 8);
                teamQueueOnly.TargetGroupId = graph.Team.Id;

                db.AddRange(
                    creator,
                    assignee,
                    reviewer,
                    collaborator,
                    manualWatch,
                    optedOutCreator,
                    visibilityOnly,
                    teamQueueOnly,
                    new WorkItemCollaborator
                    {
                        TenantId = graph.Tenant.Id,
                        TaskItemId = collaborator.Id,
                        UserId = graph.Recipient.Id,
                        AddedAt = Now,
                        AddedByUserId = graph.Actor.Id
                    },
                    new WorkItemWatchState
                    {
                        TenantId = graph.Tenant.Id,
                        TaskItemId = manualWatch.Id,
                        UserId = graph.Recipient.Id,
                        IsManualWatch = true,
                        IsWatching = true,
                        UpdatedAt = Now
                    },
                    new WorkItemWatchState
                    {
                        TenantId = graph.Tenant.Id,
                        TaskItemId = optedOutCreator.Id,
                        UserId = graph.Recipient.Id,
                        AutomaticSources = WorkItemWatchAutomaticSource.Creator,
                        IsExplicitOptOut = true,
                        IsWatching = false,
                        UpdatedAt = Now
                    });
                await db.SaveChangesAsync();

                await AddAndClaimJobThenAssertCandidatesAsync(
                    database,
                    graph,
                    [creator.Id, assignee.Id, reviewer.Id, collaborator.Id, manualWatch.Id],
                    [optedOutCreator.Id, visibilityOnly.Id, teamQueueOnly.Id]);
            }
        });
    }

    [PostgreSqlFact]
    public async Task CandidateQueryUsesCanonicalGroupRestrictedVisibilityAndKeepsNonArchivedProjectStates()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();

        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedGraphAsync(database);
            var suffix = Guid.NewGuid().ToString("N");
            var adviser = UserFor("adviser-only", suffix);
            var systemAdmin = UserFor("system-admin", suffix);
            systemAdmin.SystemRole = SystemRole.SystemAdmin;
            var ownerFieldOnly = UserFor("owner-field-only", suffix);

            await using (var platform = PostgreSqlMigrationTestDatabase.CreatePlatformContext(database))
            {
                platform.AddRange(adviser, systemAdmin, ownerFieldOnly);
                await platform.SaveChangesAsync();
            }

            TaskItem adviserTask;
            TaskItem systemAdminTask;
            TaskItem ownerFieldTask;
            TaskItem completedProjectTask;
            TaskItem suspendedProjectTask;
            await using (var db = CreateTenantContext(database, graph.Tenant))
            {
                var restricted = NewProject(graph, "group-restricted");
                restricted.GroupId = graph.Team.Id;
                restricted.OwnerUserId = ownerFieldOnly.Id;
                var completed = NewProject(graph, "completed-visible");
                completed.GroupId = graph.Team.Id;
                completed.Status = ProjectStatus.Completed;
                var suspended = NewProject(graph, "suspended-visible");
                suspended.GroupId = graph.Team.Id;
                suspended.Status = ProjectStatus.Suspended;

                adviserTask = NewTask(graph, "adviser-created restricted", 1, restricted);
                adviserTask.CreatedByUserId = adviser.Id;
                systemAdminTask = NewTask(graph, "admin-created restricted", 2, restricted);
                systemAdminTask.CreatedByUserId = systemAdmin.Id;
                ownerFieldTask = NewTask(graph, "owner-field-created restricted", 3, restricted);
                ownerFieldTask.CreatedByUserId = ownerFieldOnly.Id;
                completedProjectTask = NewTask(graph, "completed project remains visible", 4, completed);
                completedProjectTask.CreatedByUserId = systemAdmin.Id;
                suspendedProjectTask = NewTask(graph, "suspended project remains visible", 5, suspended);
                suspendedProjectTask.CreatedByUserId = systemAdmin.Id;

                db.AddRange(
                    restricted,
                    completed,
                    suspended,
                    adviserTask,
                    systemAdminTask,
                    ownerFieldTask,
                    completedProjectTask,
                    suspendedProjectTask,
                    ActiveTenantUser(graph.Tenant, adviser),
                    ActiveTenantUser(graph.Tenant, systemAdmin),
                    ActiveTenantUser(graph.Tenant, ownerFieldOnly),
                    ActiveWorkspaceMember(graph, adviser, WorkspaceRole.Adviser),
                    ActiveWorkspaceMember(graph, systemAdmin, WorkspaceRole.Member),
                    ActiveWorkspaceMember(graph, ownerFieldOnly, WorkspaceRole.Member));
                await db.SaveChangesAsync();
            }

            _ = await AddJobAsync(database, graph.Tenant, graph.Workspace, adviser, LocalDate);
            _ = await AddJobAsync(database, graph.Tenant, graph.Workspace, systemAdmin, LocalDate);
            _ = await AddJobAsync(database, graph.Tenant, graph.Workspace, ownerFieldOnly, LocalDate);

            var currentTenant = TenantScope(graph.Tenant);
            await using var queryContext = CreateTenantContext(database, graph.Tenant, currentTenant);
            var repository = new TaskDeadlineDigestRepository(queryContext, currentTenant);
            var claims = await repository.ClaimDueAsync(
                "group-visibility-test",
                Now,
                batchSize: 3,
                claimTimeout: TimeSpan.FromMinutes(2));
            Assert.Equal(3, claims.Count);
            var claimsByUser = claims.ToDictionary(claim => claim.UserId);

            Assert.Empty(await CandidateIdsAsync(repository, claimsByUser[adviser.Id]));
            Assert.Empty(await CandidateIdsAsync(repository, claimsByUser[ownerFieldOnly.Id]));
            Assert.Equal(
                [systemAdminTask.Id, completedProjectTask.Id, suspendedProjectTask.Id],
                await CandidateIdsAsync(repository, claimsByUser[systemAdmin.Id]));
            Assert.DoesNotContain(adviserTask.Id, await CandidateIdsAsync(repository, claimsByUser[systemAdmin.Id]));
            Assert.DoesNotContain(ownerFieldTask.Id, await CandidateIdsAsync(repository, claimsByUser[systemAdmin.Id]));
        });
    }

    [PostgreSqlFact]
    public async Task CandidateQueryRechecksMembershipWorkspaceProjectTaskLifecycleAndRelationship()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();

        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedGraphAsync(database);

            TaskItem active;
            TaskItem relationshipLost;
            TaskItem deleted;
            TaskItem completed;
            TaskItem cancelled;
            TaskItem archivedProjectTask;
            await using (var db = CreateTenantContext(database, graph.Tenant))
            {
                active = NewTask(graph, "active", 1);
                active.PrimaryAssigneeUserId = graph.Recipient.Id;
                relationshipLost = NewTask(graph, "relationship can be lost", 2);
                relationshipLost.PrimaryAssigneeUserId = graph.Recipient.Id;
                deleted = NewTask(graph, "deleted", 3);
                deleted.CreatedByUserId = graph.Recipient.Id;
                deleted.MarkDeleted(Now, graph.Actor.Id, "test lifecycle exclusion");
                completed = NewTask(graph, "completed", 4);
                completed.CreatedByUserId = graph.Recipient.Id;
                completed.Status = TaskItemStatus.Completed;
                completed.CompletedAt = Now;
                cancelled = NewTask(graph, "cancelled", 5);
                cancelled.CreatedByUserId = graph.Recipient.Id;
                cancelled.Status = TaskItemStatus.Cancelled;
                cancelled.CancelledAt = Now;

                var archivedProject = NewProject(graph, "archived");
                archivedProject.Status = ProjectStatus.Archived;
                archivedProjectTask = NewTask(graph, "archived project", 6, archivedProject);
                archivedProjectTask.CreatedByUserId = graph.Recipient.Id;

                db.AddRange(
                    active,
                    relationshipLost,
                    deleted,
                    completed,
                    cancelled,
                    archivedProject,
                    new ProjectMember
                    {
                        TenantId = graph.Tenant.Id,
                        ProjectId = archivedProject.Id,
                        UserId = graph.Recipient.Id,
                        Role = ProjectRole.Contributor,
                        JoinedAt = Now
                    },
                    archivedProjectTask);
                await db.SaveChangesAsync();
            }

            await AddJobAsync(database, graph);
            var currentTenant = TenantScope(graph.Tenant);
            await using var queryContext = CreateTenantContext(database, graph.Tenant, currentTenant);
            var repository = new TaskDeadlineDigestRepository(queryContext, currentTenant);
            var claim = Assert.Single(await repository.ClaimDueAsync(
                "candidate-state-test",
                Now,
                batchSize: 1,
                claimTimeout: TimeSpan.FromMinutes(2)));

            Assert.Equal(
                [active.Id, relationshipLost.Id],
                await CandidateIdsAsync(repository, claim));
            Assert.DoesNotContain(deleted.Id, await CandidateIdsAsync(repository, claim));
            Assert.DoesNotContain(completed.Id, await CandidateIdsAsync(repository, claim));
            Assert.DoesNotContain(cancelled.Id, await CandidateIdsAsync(repository, claim));
            Assert.DoesNotContain(archivedProjectTask.Id, await CandidateIdsAsync(repository, claim));

            await using (var mutation = CreateTenantContext(database, graph.Tenant))
            {
                var task = await mutation.TaskItems.SingleAsync(item => item.Id == relationshipLost.Id);
                task.PrimaryAssigneeUserId = null;
                await mutation.SaveChangesAsync();
            }
            Assert.Equal([active.Id], await CandidateIdsAsync(repository, claim));

            await using (var mutation = CreateTenantContext(database, graph.Tenant))
            {
                var member = await mutation.WorkspaceMembers.SingleAsync(item =>
                    item.WorkspaceId == graph.Workspace.Id && item.UserId == graph.Recipient.Id);
                member.Status = MembershipStatus.Suspended;
                await mutation.SaveChangesAsync();
            }
            Assert.Empty(await CandidateIdsAsync(repository, claim));

            await using (var mutation = CreateTenantContext(database, graph.Tenant))
            {
                var member = await mutation.WorkspaceMembers.SingleAsync(item =>
                    item.WorkspaceId == graph.Workspace.Id && item.UserId == graph.Recipient.Id);
                member.Status = MembershipStatus.Active;
                await mutation.SaveChangesAsync();
            }
            Assert.Equal([active.Id], await CandidateIdsAsync(repository, claim));

            await using (var mutation = CreateTenantContext(database, graph.Tenant))
            {
                var workspace = await mutation.Workspaces.SingleAsync(item => item.Id == graph.Workspace.Id);
                workspace.Status = WorkspaceStatus.Archived;
                await mutation.SaveChangesAsync();
            }
            Assert.Empty(await CandidateIdsAsync(repository, claim));
        });
    }

    [PostgreSqlFact]
    public async Task GeneratorCommitsGenericNotificationSignalUserStateAndSucceededLedgerTogether()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();

        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedGraphAsync(database);
            await AddCategoryTasksAsync(database, graph);
            await AddJobAsync(database, graph);

            var result = await GenerateAsync(database, graph);
            Assert.Equal(TaskDeadlineDigestGenerationOutcome.Succeeded, result.Outcome);
            Assert.Equal(1, result.Counts.ThreeDays);
            Assert.Equal(1, result.Counts.OneDay);
            Assert.Equal(1, result.Counts.Today);
            Assert.Equal(1, result.Counts.Overdue);
            Assert.Equal(4, result.Counts.Total);
            Assert.NotNull(result.NotificationId);

            await using var verification = CreateTenantContext(database, graph.Tenant);
            var job = await verification.TaskDeadlineDigestJobs.AsNoTracking().SingleAsync();
            Assert.Equal(TaskDeadlineDigestJobStatus.Succeeded, job.Status);
            Assert.Equal(result.NotificationId, job.NotificationId);
            Assert.Equal(Now, job.CompletedAt);
            Assert.Null(job.ClaimToken);
            var attempt = await verification.TaskDeadlineDigestAttempts.AsNoTracking().SingleAsync();
            Assert.Equal(TaskDeadlineDigestAttemptStatus.Succeeded, attempt.Status);
            Assert.Equal(Now, attempt.CompletedAt);

            var notification = await verification.Notifications.AsNoTracking().SingleAsync();
            Assert.Equal(result.NotificationId, notification.Id);
            Assert.Equal(graph.Recipient.Id, notification.UserId);
            Assert.Equal(NotificationType.TaskDueSoon, notification.NotificationType);
            Assert.Equal(TaskDeadlineDigestPolicy.NotificationTitle, notification.Title);
            Assert.Null(notification.Body);
            Assert.Equal(TaskDeadlineDigestPolicy.RelatedEntityType, notification.RelatedEntityType);
            Assert.Equal(job.Id, notification.RelatedEntityId);
            Assert.Equal(
                TaskDeadlineDigestPolicy.BuildNotificationLogicalKey(graph.Workspace.Id, LocalDate, TaskDeadlineDigestPolicy.PolicyVersion),
                notification.LogicalKey);

            var state = await verification.NotificationUserStates.AsNoTracking().SingleAsync();
            Assert.Equal(graph.Recipient.Id, state.UserId);
            Assert.Equal(1, state.Version);

            var outbox = await verification.OutboxEvents.AsNoTracking().SingleAsync();
            Assert.Equal("Notifications.NotificationCreated.v1", outbox.EventType);
            Assert.Equal("Notification", outbox.AggregateType);
            Assert.Equal(notification.Id, outbox.AggregateId);
            Assert.DoesNotContain("restricted digest task title", outbox.PayloadJson, StringComparison.Ordinal);
            using var envelope = JsonDocument.Parse(outbox.PayloadJson);
            var payload = envelope.RootElement.GetProperty("payload");
            Assert.Equal(notification.Id, payload.GetProperty("notificationId").GetGuid());
            Assert.Equal(notification.StateVersion, payload.GetProperty("stateVersion").GetInt64());
            Assert.True(payload.GetProperty("requiresRefetch").GetBoolean());
            Assert.Equal(3, payload.EnumerateObject().Count());
            Assert.Contains(graph.Recipient.Id.ToString(), outbox.RoutingJson, StringComparison.OrdinalIgnoreCase);
        });
    }

    [PostgreSqlFact]
    public async Task ConcurrentSameUserWorkspaceTimeZonesSerializeStateVersionsAndBothSucceed()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();

        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedGraphAsync(database);
            await AddQualifyingTaskAsync(database, graph);
            var utcJob = await AddJobAsync(database, graph);
            var pacific = await AddWorkspaceAsync(
                database,
                graph,
                timeZoneId: "America/Los_Angeles",
                digestLocalTime: new TimeOnly(21, 0));
            var pacificJob = await AddJobAsync(
                database,
                graph.Tenant,
                pacific.Workspace,
                graph.Recipient,
                new DateOnly(2026, 8, 2));

            var claims = new List<TaskDeadlineDigestClaim>(2);
            for (var worker = 0; worker < 2; worker++)
            {
                var claimTenant = TenantScope(graph.Tenant);
                await using var claimContext = CreateTenantContext(database, graph.Tenant, claimTenant);
                var claimRepository = new TaskDeadlineDigestRepository(claimContext, claimTenant);
                claims.Add(Assert.Single(await claimRepository.ClaimDueAsync(
                    $"timezone-worker-{worker}",
                    Now,
                    batchSize: 1,
                    claimTimeout: TimeSpan.FromMinutes(2))));
            }

            Assert.Equal(
                new[] { utcJob.Id, pacificJob.Id }.Order(),
                claims.Select(claim => claim.JobId).Order());
            var lockGate = new ConcurrentUserLockGate();
            var results = await Task.WhenAll(claims.Select(claim =>
                GenerateClaimAsync(database, graph.Tenant, claim, lockGate)));

            Assert.Equal(2, lockGate.ArrivalCount);
            Assert.All(results, result =>
            {
                Assert.Equal(TaskDeadlineDigestGenerationOutcome.Succeeded, result.Outcome);
                Assert.Equal(1, result.Counts.Today);
                Assert.Equal(1, result.Counts.Total);
                Assert.NotNull(result.NotificationId);
            });
            Assert.Equal(2, results.Select(result => result.NotificationId).Distinct().Count());

            await using var verification = CreateTenantContext(database, graph.Tenant);
            var jobs = await verification.TaskDeadlineDigestJobs.AsNoTracking()
                .OrderBy(job => job.WorkspaceId)
                .ToListAsync();
            Assert.Equal(2, jobs.Count);
            Assert.All(jobs, job => Assert.Equal(TaskDeadlineDigestJobStatus.Succeeded, job.Status));
            Assert.Contains(jobs, job => job.WorkspaceId == graph.Workspace.Id && job.LocalDate == LocalDate);
            Assert.Contains(jobs, job =>
                job.WorkspaceId == pacific.Workspace.Id && job.LocalDate == new DateOnly(2026, 8, 2));

            var notifications = await verification.Notifications.AsNoTracking()
                .OrderBy(notification => notification.StateVersion)
                .ToListAsync();
            Assert.Equal(2, notifications.Count);
            Assert.Equal([1L, 2L], notifications.Select(notification => notification.StateVersion));
            Assert.All(notifications, notification => Assert.Equal(graph.Recipient.Id, notification.UserId));
            Assert.Equal(2, await verification.OutboxEvents.CountAsync());
            Assert.Equal(2, (await verification.NotificationUserStates.AsNoTracking().SingleAsync()).Version);
        });
    }

    [PostgreSqlFact]
    public async Task MembershipRevokedWhileRecipientLockWaitsIsRecheckedBeforeNotificationCommit()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();

        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedGraphAsync(database);
            await AddQualifyingTaskAsync(database, graph);
            await AddJobAsync(database, graph);

            TaskDeadlineDigestClaim claim;
            var claimTenant = TenantScope(graph.Tenant);
            await using (var claimContext = CreateTenantContext(database, graph.Tenant, claimTenant))
            {
                var claimRepository = new TaskDeadlineDigestRepository(claimContext, claimTenant);
                claim = Assert.Single(await claimRepository.ClaimDueAsync(
                    "membership-recheck-worker",
                    Now,
                    batchSize: 1,
                    claimTimeout: TimeSpan.FromMinutes(2)));
            }

            var lockTenant = TenantScope(graph.Tenant);
            await using var lockContext = CreateTenantContext(database, graph.Tenant, lockTenant);
            await using var lockTransaction = await lockContext.Database.BeginTransactionAsync();
            await lockContext.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT 1 FROM users WHERE \"Id\" = {graph.Recipient.Id} FOR UPDATE");

            var lockArrival = new UserLockArrivalInterceptor();
            var generation = GenerateClaimAsync(database, graph.Tenant, claim, lockArrival);
            await lockArrival.WaitForArrivalAsync();

            await using (var mutation = CreateTenantContext(database, graph.Tenant))
            {
                var membership = await mutation.WorkspaceMembers.SingleAsync(member =>
                    member.WorkspaceId == graph.Workspace.Id &&
                    member.UserId == graph.Recipient.Id);
                membership.Status = MembershipStatus.Suspended;
                await mutation.SaveChangesAsync();
            }

            var remainedBlockedUntilLockRelease = !generation.IsCompleted;
            await lockTransaction.CommitAsync();
            var result = await generation.WaitAsync(TimeSpan.FromSeconds(15));

            Assert.True(remainedBlockedUntilLockRelease);
            Assert.Equal(TaskDeadlineDigestGenerationOutcome.SucceededWithoutCandidates, result.Outcome);
            Assert.Equal(0, result.Counts.Total);
            Assert.Null(result.NotificationId);

            await using var verification = CreateTenantContext(database, graph.Tenant);
            var job = await verification.TaskDeadlineDigestJobs.AsNoTracking().SingleAsync();
            Assert.Equal(TaskDeadlineDigestJobStatus.Succeeded, job.Status);
            Assert.Null(job.NotificationId);
            Assert.Equal(
                TaskDeadlineDigestAttemptStatus.Succeeded,
                (await verification.TaskDeadlineDigestAttempts.AsNoTracking().SingleAsync()).Status);
            Assert.Empty(await verification.Notifications.AsNoTracking().ToListAsync());
            Assert.Empty(await verification.NotificationUserStates.AsNoTracking().ToListAsync());
            Assert.Empty(await verification.OutboxEvents.AsNoTracking().ToListAsync());
        });
    }

    [PostgreSqlFact]
    public async Task GeneratorWithNoCurrentCandidatesSucceedsWithoutNotificationOrOutbox()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();

        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedGraphAsync(database);
            await AddJobAsync(database, graph);

            var result = await GenerateAsync(database, graph);
            Assert.Equal(TaskDeadlineDigestGenerationOutcome.SucceededWithoutCandidates, result.Outcome);
            Assert.Equal(0, result.Counts.Total);
            Assert.Null(result.NotificationId);

            await using var verification = CreateTenantContext(database, graph.Tenant);
            var job = await verification.TaskDeadlineDigestJobs.AsNoTracking().SingleAsync();
            Assert.Equal(TaskDeadlineDigestJobStatus.Succeeded, job.Status);
            Assert.Null(job.NotificationId);
            Assert.Equal(TaskDeadlineDigestAttemptStatus.Succeeded,
                (await verification.TaskDeadlineDigestAttempts.AsNoTracking().SingleAsync()).Status);
            Assert.Empty(await verification.Notifications.AsNoTracking().ToListAsync());
            Assert.Empty(await verification.NotificationUserStates.AsNoTracking().ToListAsync());
            Assert.Empty(await verification.OutboxEvents.AsNoTracking().ToListAsync());
        });
    }

    [PostgreSqlFact]
    public async Task GeneratorReusesPersistedLogicalNotificationWithoutSecondSignalOrStateAdvance()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();

        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedGraphAsync(database);
            await AddQualifyingTaskAsync(database, graph);
            var job = await AddJobAsync(database, graph);
            var logicalKey = TaskDeadlineDigestPolicy.BuildNotificationLogicalKey(
                graph.Workspace.Id,
                LocalDate,
                TaskDeadlineDigestPolicy.PolicyVersion);

            Guid existingNotificationId;
            var clock = new FixedClock(Now);
            var stagingTenant = TenantScope(graph.Tenant);
            await using (var staging = CreateTenantContext(database, graph.Tenant, stagingTenant))
            {
                var outbox = new TransactionalOutbox(
                    new OutboxEventRepository(staging),
                    stagingTenant,
                    clock);
                var notifications = new DbNotificationService(staging, clock, stagingTenant, outbox);
                existingNotificationId = await notifications.StageTaskDeadlineDigestByLogicalKeyAsync(
                    graph.Recipient.Id,
                    job.Id,
                    logicalKey);
                await staging.SaveChangesAsync();
            }

            var result = await GenerateAsync(database, graph);
            Assert.Equal(TaskDeadlineDigestGenerationOutcome.Succeeded, result.Outcome);
            Assert.Equal(existingNotificationId, result.NotificationId);

            await using var verification = CreateTenantContext(database, graph.Tenant);
            Assert.Equal(1, await verification.Notifications.CountAsync());
            Assert.Equal(1, await verification.OutboxEvents.CountAsync());
            var state = await verification.NotificationUserStates.AsNoTracking().SingleAsync();
            Assert.Equal(1, state.Version);
            var persisted = await verification.TaskDeadlineDigestJobs.AsNoTracking().SingleAsync();
            Assert.Equal(TaskDeadlineDigestJobStatus.Succeeded, persisted.Status);
            Assert.Equal(existingNotificationId, persisted.NotificationId);
        });
    }

    [PostgreSqlFact]
    public async Task SaveFailureAfterStagingRollsBackNotificationSignalUserStateAndLedgerSuccess()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();

        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedGraphAsync(database);
            await AddQualifyingTaskAsync(database, graph);
            await AddJobAsync(database, graph);

            var interceptor = new ThrowAfterSaveInterceptor();
            var currentTenant = TenantScope(graph.Tenant);
            await using (var db = CreateTenantContext(database, graph.Tenant, currentTenant, interceptor))
            {
                var repository = new TaskDeadlineDigestRepository(db, currentTenant);
                var claim = Assert.Single(await repository.ClaimDueAsync(
                    "atomic-rollback-test",
                    Now,
                    batchSize: 1,
                    claimTimeout: TimeSpan.FromMinutes(2)));
                var clock = new FixedClock(Now);
                var outbox = new TransactionalOutbox(new OutboxEventRepository(db), currentTenant, clock);
                var notifications = new DbNotificationService(db, clock, currentTenant, outbox);
                var generator = new TaskDeadlineDigestGenerator(
                    repository,
                    notifications,
                    EnabledFeatureFlags.Instance,
                    new TaskDeadlineDigestDiagnostics());

                interceptor.Arm();
                await Assert.ThrowsAsync<InjectedSaveFailureException>(() =>
                    generator.GenerateAsync(claim, Now, candidatePageSize: 50));
            }

            await using var verification = CreateTenantContext(database, graph.Tenant);
            var job = await verification.TaskDeadlineDigestJobs.AsNoTracking().SingleAsync();
            Assert.Equal(TaskDeadlineDigestJobStatus.Claimed, job.Status);
            Assert.NotNull(job.ClaimToken);
            Assert.Null(job.NotificationId);
            Assert.Equal(TaskDeadlineDigestAttemptStatus.Claimed,
                (await verification.TaskDeadlineDigestAttempts.AsNoTracking().SingleAsync()).Status);
            Assert.Empty(await verification.Notifications.AsNoTracking().ToListAsync());
            Assert.Empty(await verification.NotificationUserStates.AsNoTracking().ToListAsync());
            Assert.Empty(await verification.OutboxEvents.AsNoTracking().ToListAsync());
        });
    }

    private static async Task AddAndClaimJobThenAssertCandidatesAsync(
        string database,
        Graph graph,
        IReadOnlyCollection<Guid> included,
        IReadOnlyCollection<Guid> excluded)
    {
        await AddJobAsync(database, graph);
        var currentTenant = TenantScope(graph.Tenant);
        await using var queryContext = CreateTenantContext(database, graph.Tenant, currentTenant);
        var repository = new TaskDeadlineDigestRepository(queryContext, currentTenant);
        var claim = Assert.Single(await repository.ClaimDueAsync(
            "candidate-policy-test",
            Now,
            batchSize: 1,
            claimTimeout: TimeSpan.FromMinutes(2)));
        var actual = await CandidateIdsAsync(repository, claim);
        Assert.Equal(included.Order(), actual.Order());
        Assert.All(excluded, taskId => Assert.DoesNotContain(taskId, actual));
    }

    private static async Task<IReadOnlyList<Guid>> CandidateIdsAsync(
        TaskDeadlineDigestRepository repository,
        TaskDeadlineDigestClaim claim) =>
        (await repository.ListCurrentCandidatesAsync(
            claim.JobId,
            claim.ClaimToken,
            Now.AddDays(4),
            page: 0,
            pageSize: 100)).Select(candidate => candidate.TaskId).ToArray();

    private static async Task<TaskDeadlineDigestGenerationResult> GenerateAsync(
        string database,
        Graph graph)
    {
        var currentTenant = TenantScope(graph.Tenant);
        await using var db = CreateTenantContext(database, graph.Tenant, currentTenant);
        var repository = new TaskDeadlineDigestRepository(db, currentTenant);
        var claim = Assert.Single(await repository.ClaimDueAsync(
            "generator-test",
            Now,
            batchSize: 1,
            claimTimeout: TimeSpan.FromMinutes(2)));
        var clock = new FixedClock(Now);
        var outbox = new TransactionalOutbox(new OutboxEventRepository(db), currentTenant, clock);
        var notifications = new DbNotificationService(db, clock, currentTenant, outbox);
        var generator = new TaskDeadlineDigestGenerator(
            repository,
            notifications,
            EnabledFeatureFlags.Instance,
            new TaskDeadlineDigestDiagnostics());
        return await generator.GenerateAsync(claim, Now, candidatePageSize: 50);
    }

    private static async Task<TaskDeadlineDigestGenerationResult> GenerateClaimAsync(
        string database,
        Tenant tenant,
        TaskDeadlineDigestClaim claim,
        IInterceptor interceptor)
    {
        var currentTenant = TenantScope(tenant);
        await using var db = CreateTenantContext(database, tenant, currentTenant, interceptor);
        var repository = new TaskDeadlineDigestRepository(db, currentTenant);
        var clock = new FixedClock(Now);
        var outbox = new TransactionalOutbox(new OutboxEventRepository(db), currentTenant, clock);
        var notifications = new DbNotificationService(db, clock, currentTenant, outbox);
        var generator = new TaskDeadlineDigestGenerator(
            repository,
            notifications,
            EnabledFeatureFlags.Instance,
            new TaskDeadlineDigestDiagnostics());
        return await generator.GenerateAsync(claim, Now, candidatePageSize: 50);
    }

    private static Task<TaskDeadlineDigestJob> AddJobAsync(string database, Graph graph) =>
        AddJobAsync(database, graph.Tenant, graph.Workspace, graph.Recipient, LocalDate);

    private static async Task<TaskDeadlineDigestJob> AddJobAsync(
        string database,
        Tenant tenant,
        Workspace workspace,
        User recipient,
        DateOnly localDate)
    {
        await using var db = CreateTenantContext(database, tenant);
        var job = new TaskDeadlineDigestJob
        {
            TenantId = tenant.Id,
            WorkspaceId = workspace.Id,
            UserId = recipient.Id,
            LocalDate = localDate,
            PolicyVersion = TaskDeadlineDigestPolicy.PolicyVersion,
            Status = TaskDeadlineDigestJobStatus.Pending,
            ScheduledForUtc = Now.AddMinutes(-30),
            NextAttemptAt = Now.AddMinutes(-30)
        };
        db.TaskDeadlineDigestJobs.Add(job);
        await db.SaveChangesAsync();
        return job;
    }

    private static async Task<TaskItem> AddQualifyingTaskAsync(string database, Graph graph)
    {
        await using var db = CreateTenantContext(database, graph.Tenant);
        var task = NewTask(graph, "restricted digest task title", 1);
        task.PrimaryAssigneeUserId = graph.Recipient.Id;
        db.TaskItems.Add(task);
        await db.SaveChangesAsync();
        return task;
    }

    private static async Task AddCategoryTasksAsync(string database, Graph graph)
    {
        await using var db = CreateTenantContext(database, graph.Tenant);
        var overdue = NewTask(graph, "restricted overdue title", 1);
        overdue.DeadlineAt = Now.AddMinutes(-1);
        var today = NewTask(graph, "restricted today title", 2);
        today.DeadlineAt = new DateTimeOffset(2026, 8, 3, 18, 0, 0, TimeSpan.Zero);
        var oneDay = NewTask(graph, "restricted one-day title", 3);
        oneDay.DeadlineAt = new DateTimeOffset(2026, 8, 4, 18, 0, 0, TimeSpan.Zero);
        var threeDays = NewTask(graph, "restricted three-day title", 4);
        threeDays.DeadlineAt = new DateTimeOffset(2026, 8, 6, 18, 0, 0, TimeSpan.Zero);
        foreach (var task in new[] { overdue, today, oneDay, threeDays })
            task.PrimaryAssigneeUserId = graph.Recipient.Id;
        db.AddRange(overdue, today, oneDay, threeDays);
        await db.SaveChangesAsync();
    }

    private static async Task<WorkspaceGraph> AddWorkspaceAsync(
        string database,
        Graph graph,
        string timeZoneId,
        TimeOnly digestLocalTime)
    {
        var suffix = Guid.NewGuid().ToString("N");
        var workspace = new Workspace
        {
            TenantId = graph.Tenant.Id,
            Name = "PR07-C Pacific Workspace",
            Slug = $"pr07c-pacific-{suffix}",
            TimeZone = timeZoneId,
            DefaultTaskDeadlineDigestLocalTime = digestLocalTime,
            Status = WorkspaceStatus.Active,
            CreatedByUserId = graph.Actor.Id
        };
        var project = new Project
        {
            TenantId = graph.Tenant.Id,
            WorkspaceId = workspace.Id,
            OwnerUserId = graph.Actor.Id,
            CreatedByUserId = graph.Actor.Id,
            Name = "PR07-C Pacific Project",
            Slug = $"pr07c-pacific-project-{suffix}",
            Status = ProjectStatus.Active,
            VersionNo = 1
        };
        var task = new TaskItem
        {
            TenantId = graph.Tenant.Id,
            WorkspaceId = workspace.Id,
            ProjectId = project.Id,
            Title = "restricted Pacific task title",
            Status = TaskItemStatus.InProgress,
            Kind = WorkItemKind.Task,
            DeadlineAt = Now.AddMinutes(1),
            PrimaryAssigneeUserId = graph.Recipient.Id,
            CreatedByUserId = graph.Actor.Id,
            VersionNo = 1
        };

        await using var db = CreateTenantContext(database, graph.Tenant);
        db.AddRange(
            workspace,
            project,
            task,
            new WorkspaceMember
            {
                TenantId = graph.Tenant.Id,
                WorkspaceId = workspace.Id,
                UserId = graph.Actor.Id,
                Role = WorkspaceRole.Owner,
                Status = MembershipStatus.Active,
                JoinedAt = Now
            },
            new WorkspaceMember
            {
                TenantId = graph.Tenant.Id,
                WorkspaceId = workspace.Id,
                UserId = graph.Recipient.Id,
                Role = WorkspaceRole.Member,
                Status = MembershipStatus.Active,
                JoinedAt = Now
            },
            new ProjectMember
            {
                TenantId = graph.Tenant.Id,
                ProjectId = project.Id,
                UserId = graph.Recipient.Id,
                Role = ProjectRole.Contributor,
                JoinedAt = Now
            });
        await db.SaveChangesAsync();
        return new WorkspaceGraph(workspace, project, task);
    }

    private static TaskItem NewTask(
        Graph graph,
        string title,
        int deadlineMinute,
        Project? project = null) =>
        new()
        {
            TenantId = graph.Tenant.Id,
            WorkspaceId = graph.Workspace.Id,
            ProjectId = (project ?? graph.Project).Id,
            Title = title,
            Status = TaskItemStatus.InProgress,
            Kind = WorkItemKind.Task,
            DeadlineAt = Now.AddMinutes(deadlineMinute),
            VersionNo = 1,
            CreatedByUserId = graph.Actor.Id
        };

    private static Project NewProject(Graph graph, string name) => new()
    {
        TenantId = graph.Tenant.Id,
        WorkspaceId = graph.Workspace.Id,
        OwnerUserId = graph.Actor.Id,
        CreatedByUserId = graph.Actor.Id,
        Name = $"PR07-C {name}",
        Slug = $"pr07c-{name}-{Guid.NewGuid():N}",
        Status = ProjectStatus.Active,
        VersionNo = 1
    };

    private static async Task<Graph> SeedGraphAsync(string database)
    {
        var suffix = Guid.NewGuid().ToString("N");
        var tenant = new Tenant
        {
            Name = $"PR07-C candidate atomicity {suffix}",
            DisplayName = "PR07-C candidate atomicity",
            Slug = $"pr07c-candidate-{suffix}",
            Status = TenantStatus.Active
        };
        var actor = UserFor("actor", suffix);
        var recipient = UserFor("recipient", suffix);

        await using (var platform = PostgreSqlMigrationTestDatabase.CreatePlatformContext(database))
        {
            platform.AddRange(tenant, actor, recipient);
            await platform.SaveChangesAsync();
        }

        var workspace = new Workspace
        {
            TenantId = tenant.Id,
            Name = "PR07-C Workspace",
            Slug = $"pr07c-workspace-{suffix}",
            TimeZone = "UTC",
            DefaultTaskDeadlineDigestLocalTime = new TimeOnly(4, 0),
            Status = WorkspaceStatus.Active,
            CreatedByUserId = actor.Id
        };
        var project = new Project
        {
            TenantId = tenant.Id,
            WorkspaceId = workspace.Id,
            OwnerUserId = actor.Id,
            CreatedByUserId = actor.Id,
            Name = "PR07-C Project",
            Slug = $"pr07c-project-{suffix}",
            Status = ProjectStatus.Active,
            VersionNo = 1
        };
        var team = new Group
        {
            TenantId = tenant.Id,
            WorkspaceId = workspace.Id,
            Name = "PR07-C Team Queue",
            Slug = $"pr07c-team-{suffix}",
            GroupType = GroupType.Team,
            Status = GroupStatus.Active,
            CreatedByUserId = actor.Id
        };

        await using (var db = CreateTenantContext(database, tenant))
        {
            db.AddRange(
                workspace,
                project,
                team,
                new TenantUser
                {
                    TenantId = tenant.Id,
                    UserId = actor.Id,
                    Role = TenantUserRole.Member,
                    Status = TenantUserStatus.Active,
                    JoinedAt = Now
                },
                new TenantUser
                {
                    TenantId = tenant.Id,
                    UserId = recipient.Id,
                    Role = TenantUserRole.Member,
                    Status = TenantUserStatus.Active,
                    JoinedAt = Now
                },
                new WorkspaceMember
                {
                    TenantId = tenant.Id,
                    WorkspaceId = workspace.Id,
                    UserId = actor.Id,
                    Role = WorkspaceRole.Owner,
                    Status = MembershipStatus.Active,
                    JoinedAt = Now
                },
                new WorkspaceMember
                {
                    TenantId = tenant.Id,
                    WorkspaceId = workspace.Id,
                    UserId = recipient.Id,
                    Role = WorkspaceRole.Member,
                    Status = MembershipStatus.Active,
                    JoinedAt = Now
                },
                new ProjectMember
                {
                    TenantId = tenant.Id,
                    ProjectId = project.Id,
                    UserId = actor.Id,
                    Role = ProjectRole.Owner,
                    JoinedAt = Now
                },
                new ProjectMember
                {
                    TenantId = tenant.Id,
                    ProjectId = project.Id,
                    UserId = recipient.Id,
                    Role = ProjectRole.Contributor,
                    JoinedAt = Now
                },
                new GroupMember
                {
                    TenantId = tenant.Id,
                    GroupId = team.Id,
                    UserId = recipient.Id,
                    Role = GroupRole.Member,
                    JoinedAt = Now
                });
            await db.SaveChangesAsync();
        }

        return new Graph(tenant, workspace, project, team, actor, recipient);
    }

    private static User UserFor(string role, string suffix) => new()
    {
        DisplayName = $"PR07-C {role}",
        Email = $"pr07c-{role}-{suffix}@example.test",
        NormalizedEmail = $"PR07C-{role}-{suffix}@EXAMPLE.TEST",
        PasswordHash = "hash",
        Status = UserStatus.Active
    };

    private static TenantUser ActiveTenantUser(Tenant tenant, User user) => new()
    {
        TenantId = tenant.Id,
        UserId = user.Id,
        Role = TenantUserRole.Member,
        Status = TenantUserStatus.Active,
        JoinedAt = Now
    };

    private static WorkspaceMember ActiveWorkspaceMember(
        Graph graph,
        User user,
        WorkspaceRole role) => new()
    {
        TenantId = graph.Tenant.Id,
        WorkspaceId = graph.Workspace.Id,
        UserId = user.Id,
        Role = role,
        Status = MembershipStatus.Active,
        JoinedAt = Now
    };

    private static AppDbContext CreateTenantContext(
        string database,
        Tenant tenant,
        CurrentTenantService? currentTenant = null,
        IInterceptor? interceptor = null)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(database);
        if (interceptor is not null)
            options.AddInterceptors(interceptor);
        return new AppDbContext(options.Options, currentTenant ?? TenantScope(tenant));
    }

    private static CurrentTenantService TenantScope(Tenant tenant)
    {
        var currentTenant = new CurrentTenantService();
        currentTenant.SetTenant(tenant.Id, tenant.Slug);
        return currentTenant;
    }

    private sealed record Graph(
        Tenant Tenant,
        Workspace Workspace,
        Project Project,
        Group Team,
        User Actor,
        User Recipient);

    private sealed record WorkspaceGraph(Workspace Workspace, Project Project, TaskItem Task);

    private sealed class FixedClock(DateTimeOffset now) : IClock
    {
        public DateTimeOffset UtcNow => now;
    }

    private sealed class EnabledFeatureFlags : IFeatureFlagService
    {
        public static EnabledFeatureFlags Instance { get; } = new();

        public Task<bool> IsEnabledAsync(string featureKey, CancellationToken cancellationToken = default) =>
            Task.FromResult(string.Equals(
                FeatureKeys.Normalize(featureKey),
                FeatureKeys.TasksNotificationsV1,
                StringComparison.Ordinal));

        public async Task<Result> RequireEnabledAsync(
            string featureKey,
            CancellationToken cancellationToken = default) =>
            await IsEnabledAsync(featureKey, cancellationToken)
                ? Result.Success()
                : Result.Failure($"Feature '{featureKey}' is disabled.");

        public Task<IReadOnlyList<string>> GetEnabledFeaturesAsync(
            Guid tenantId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<string>>([FeatureKeys.TasksNotificationsV1]);
    }

    private sealed class ThrowAfterSaveInterceptor : SaveChangesInterceptor
    {
        private int armed;

        public void Arm() => Interlocked.Exchange(ref armed, 1);

        public override ValueTask<int> SavedChangesAsync(
            SaveChangesCompletedEventData eventData,
            int result,
            CancellationToken cancellationToken = default)
        {
            if (Interlocked.Exchange(ref armed, 0) == 1)
                throw new InjectedSaveFailureException();

            return base.SavedChangesAsync(eventData, result, cancellationToken);
        }
    }

    private sealed class ConcurrentUserLockGate : DbCommandInterceptor
    {
        private readonly TaskCompletionSource release = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int arrivalCount;

        public int ArrivalCount => Volatile.Read(ref arrivalCount);

        public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("SELECT 1 FROM users", StringComparison.Ordinal) &&
                command.CommandText.Contains("FOR UPDATE", StringComparison.Ordinal))
            {
                if (Interlocked.Increment(ref arrivalCount) == 2)
                    release.TrySetResult();
                await release.Task.WaitAsync(TimeSpan.FromSeconds(15), cancellationToken);
            }

            return result;
        }
    }

    private sealed class UserLockArrivalInterceptor : DbCommandInterceptor
    {
        private readonly TaskCompletionSource arrived = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public Task WaitForArrivalAsync() =>
            arrived.Task.WaitAsync(TimeSpan.FromSeconds(15));

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("SELECT 1 FROM users", StringComparison.Ordinal) &&
                command.CommandText.Contains("FOR UPDATE", StringComparison.Ordinal))
            {
                arrived.TrySetResult();
            }

            return base.NonQueryExecutingAsync(command, eventData, result, cancellationToken);
        }
    }

    private sealed class InjectedSaveFailureException : Exception;
}
