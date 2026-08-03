using System.Data.Common;
using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Application.Notifications;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;
using Xunit.Abstractions;

namespace AipPortal.Tests.PostgreSql;

[Trait("Category", "PostgreSQLIntegration")]
[Trait("Scope", "TaskV1PR07C")]
public sealed class TaskV1Pr07CDeadlineDigestPostgreSqlTests(ITestOutputHelper output)
{
    private const string PreviousMigration = "20260801171714_AddTaskNotificationPreferenceFoundation";
    private const string DigestMigration = "20260803041347_AddTaskDeadlineDigestLedger";
    private static readonly DateTimeOffset Now = new(2026, 8, 3, 4, 30, 0, TimeSpan.Zero);

    [PostgreSqlFact]
    public async Task FreshMigrationCreatesLedgerModelAndEnforcesFiveFieldIdentity()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();

        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);

            await using (var platform = PostgreSqlMigrationTestDatabase.CreatePlatformContext(database))
            {
                Assert.Equal(
                    "task_deadline_digest_jobs",
                    platform.Model.FindEntityType(typeof(TaskDeadlineDigestJob))?.GetTableName());
                Assert.Equal(
                    "task_deadline_digest_attempts",
                    platform.Model.FindEntityType(typeof(TaskDeadlineDigestAttempt))?.GetTableName());
            }

            Assert.True(await TableExistsAsync(database, "task_deadline_digest_jobs"));
            Assert.True(await TableExistsAsync(database, "task_deadline_digest_attempts"));
            var identityDefinition = await PostgreSqlMigrationTestDatabase.ScalarAsync<string>(
                database,
                "SELECT indexdef FROM pg_indexes WHERE tablename = 'task_deadline_digest_jobs' AND indexname = 'IX_task_deadline_digest_jobs_identity';");
            Assert.Contains(
                "(\"TenantId\", \"WorkspaceId\", \"UserId\", \"LocalDate\", \"PolicyVersion\")",
                identityDefinition,
                StringComparison.Ordinal);
            Assert.Contains("UNIQUE INDEX", identityDefinition, StringComparison.OrdinalIgnoreCase);

            var graph = await SeedGraphAsync(database);
            var localDate = new DateOnly(2026, 8, 3);
            await InsertJobAsync(database, graph, localDate, TaskDeadlineDigestPolicy.PolicyVersion, Now);

            await using var duplicateContext = CreateTenantContext(database, graph.Tenant);
            duplicateContext.TaskDeadlineDigestJobs.Add(NewJob(
                graph,
                localDate,
                TaskDeadlineDigestPolicy.PolicyVersion,
                Now));
            var duplicate = await Assert.ThrowsAsync<DbUpdateException>(
                () => duplicateContext.SaveChangesAsync());
            var postgres = Assert.IsType<PostgresException>(duplicate.InnerException);
            Assert.Equal(PostgresErrorCodes.UniqueViolation, postgres.SqlState);
            Assert.Equal("IX_task_deadline_digest_jobs_identity", postgres.ConstraintName);
        });
    }

    [PostgreSqlFact]
    public async Task UpgradeRollbackAndReupgradePreserveMigrationBoundary()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();

        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database, PreviousMigration);
            Assert.False(await TableExistsAsync(database, "task_deadline_digest_jobs"));
            Assert.False(await TableExistsAsync(database, "task_deadline_digest_attempts"));
            Assert.False(await MigrationAppliedAsync(database, DigestMigration));

            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            Assert.True(await TableExistsAsync(database, "task_deadline_digest_jobs"));
            Assert.True(await TableExistsAsync(database, "task_deadline_digest_attempts"));
            Assert.True(await MigrationAppliedAsync(database, DigestMigration));

            await PostgreSqlMigrationTestDatabase.MigrateAsync(database, PreviousMigration);
            Assert.False(await TableExistsAsync(database, "task_deadline_digest_jobs"));
            Assert.False(await TableExistsAsync(database, "task_deadline_digest_attempts"));
            Assert.False(await MigrationAppliedAsync(database, DigestMigration));
            Assert.True(await MigrationAppliedAsync(database, PreviousMigration));

            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            Assert.True(await TableExistsAsync(database, "task_deadline_digest_jobs"));
            Assert.True(await TableExistsAsync(database, "task_deadline_digest_attempts"));
            Assert.True(await MigrationAppliedAsync(database, DigestMigration));
            Assert.True(await PostgreSqlMigrationTestDatabase.ScalarAsync<bool>(
                database,
                "SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'task_deadline_digest_jobs' AND indexname = 'IX_task_deadline_digest_jobs_identity');"));
        });
    }

    [PostgreSqlFact]
    public async Task DueAndClaimQueriesUseFocusedPartialIndexes()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();

        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedGraphAsync(database);
            await SeedLedgerPlanRowsAsync(database, graph);

            var duePlan = await ExplainAsync(
                database,
                """
                EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
                SELECT *
                FROM task_deadline_digest_jobs
                WHERE "Status" = 'Pending'
                  AND "TenantId" = @tenantId
                  AND "NextAttemptAt" <= @threshold
                ORDER BY "NextAttemptAt", "CreatedAt", "Id"
                LIMIT 25
                FOR UPDATE SKIP LOCKED;
                """,
                ("tenantId", graph.Tenant.Id),
                ("threshold", Now.AddMinutes(-60)));
            var claimPlan = await ExplainAsync(
                database,
                """
                EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
                SELECT *
                FROM task_deadline_digest_jobs
                WHERE "Status" = 'Claimed'
                  AND "TenantId" = @tenantId
                  AND "ClaimExpiresAt" <= @threshold
                ORDER BY "ClaimExpiresAt", "CreatedAt", "Id"
                LIMIT 25
                FOR UPDATE SKIP LOCKED;
                """,
                ("tenantId", graph.Tenant.Id),
                ("threshold", Now.AddMinutes(-60)));

            output.WriteLine($"PR07-C due ledger plan:{Environment.NewLine}{duePlan}");
            output.WriteLine($"PR07-C expired-claim ledger plan:{Environment.NewLine}{claimPlan}");
            Assert.Contains("IX_task_deadline_digest_jobs_due", duePlan, StringComparison.Ordinal);
            Assert.Contains("IX_task_deadline_digest_jobs_claim_expiry", claimPlan, StringComparison.Ordinal);
        });
    }

    [PostgreSqlFact]
    public async Task CandidateQueryIsOneBoundedCommandPerPageAndPreservesPageOrder()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();

        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedGraphAsync(database);
            var expected = await SeedCandidateTasksAsync(database, graph);
            var job = await InsertJobAsync(
                database,
                graph,
                new DateOnly(2026, 8, 3),
                TaskDeadlineDigestPolicy.PolicyVersion,
                Now);

            TaskDeadlineDigestClaim claim;
            await using (var claimContext = CreateTenantContext(database, graph.Tenant))
            {
                var claimTenant = TenantScope(graph.Tenant);
                var repository = new TaskDeadlineDigestRepository(claimContext, claimTenant);
                claim = Assert.Single(await repository.ClaimDueAsync(
                    "candidate-worker",
                    Now,
                    batchSize: 1,
                    claimTimeout: TimeSpan.FromMinutes(2)));
            }

            var interceptor = new CandidateCommandInterceptor();
            await using var candidateContext = CreateTenantContext(database, graph.Tenant, interceptor);
            var candidateTenant = TenantScope(graph.Tenant);
            var candidateRepository = new TaskDeadlineDigestRepository(candidateContext, candidateTenant);

            var bounded = await candidateRepository.ListCurrentCandidatesAsync(
                job.Id,
                claim.ClaimToken,
                Now.AddDays(1),
                page: 0,
                pageSize: int.MaxValue);
            var boundedCommand = Assert.Single(interceptor.Commands);
            Assert.Equal(expected, bounded.Select(candidate => candidate.TaskId));
            Assert.Contains("LIMIT", boundedCommand.CommandText, StringComparison.OrdinalIgnoreCase);
            Assert.Contains(500, boundedCommand.IntegerParameterValues);

            interceptor.Clear();
            var firstPage = await candidateRepository.ListCurrentCandidatesAsync(
                job.Id,
                claim.ClaimToken,
                Now.AddDays(1),
                page: 0,
                pageSize: 2);
            Assert.Single(interceptor.Commands);
            Assert.Equal(expected.Take(2), firstPage.Select(candidate => candidate.TaskId));

            interceptor.Clear();
            var secondPage = await candidateRepository.ListCurrentCandidatesAsync(
                job.Id,
                claim.ClaimToken,
                Now.AddDays(1),
                page: 1,
                pageSize: 2);
            var secondPageCommand = Assert.Single(interceptor.Commands);
            Assert.Equal(expected.Skip(2).Take(2), secondPage.Select(candidate => candidate.TaskId));
            Assert.Contains("OFFSET", secondPageCommand.CommandText, StringComparison.OrdinalIgnoreCase);
            Assert.Contains(2, secondPageCommand.IntegerParameterValues);

            output.WriteLine(
                $"PR07-C candidate query: one command/page; requested pageSize={int.MaxValue} bound to 500; SQL={NormalizeSql(boundedCommand.CommandText)}");
        });
    }

    [PostgreSqlFact]
    public async Task DstFoldSchedulingAcrossBothInstantsCreatesOneLedgerIdentityAndOneClaim()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();

        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedGraphAsync(database);
            await using (var settingsContext = CreateTenantContext(database, graph.Tenant))
            {
                var workspace = await settingsContext.Workspaces.SingleAsync(item => item.Id == graph.Workspace.Id);
                workspace.TimeZone = "America/New_York";
                workspace.DefaultTaskDeadlineDigestLocalTime = new TimeOnly(1, 30);
                await settingsContext.SaveChangesAsync();
            }

            var runSettings = new TaskDeadlineDigestRunSettings(
                SchedulePageSize: 25,
                ClaimBatchSize: 10,
                CandidatePageSize: 25,
                ClaimTimeout: TimeSpan.FromHours(2),
                RetryDelay: TimeSpan.FromMinutes(1));
            var firstFoldInstant = new DateTimeOffset(2026, 11, 1, 5, 30, 0, TimeSpan.Zero);
            var secondFoldInstant = new DateTimeOffset(2026, 11, 1, 6, 30, 0, TimeSpan.Zero);

            TaskDeadlineDigestClaim firstClaim;
            await using (var firstContext = CreateTenantContext(database, graph.Tenant))
            {
                var firstTenant = TenantScope(graph.Tenant);
                var firstRepository = new TaskDeadlineDigestRepository(firstContext, firstTenant);
                var firstScheduler = new TaskDeadlineDigestScheduler(
                    firstRepository,
                    EnabledFeatureFlags.Instance,
                    firstTenant,
                    new TaskDeadlineDigestDiagnostics());
                firstClaim = Assert.Single(await firstScheduler.ScheduleAndClaimAsync(
                    "fold-worker-first",
                    firstFoldInstant,
                    runSettings));
            }

            await using (var secondContext = CreateTenantContext(database, graph.Tenant))
            {
                var secondTenant = TenantScope(graph.Tenant);
                var secondRepository = new TaskDeadlineDigestRepository(secondContext, secondTenant);
                var secondScheduler = new TaskDeadlineDigestScheduler(
                    secondRepository,
                    EnabledFeatureFlags.Instance,
                    secondTenant,
                    new TaskDeadlineDigestDiagnostics());
                Assert.Empty(await secondScheduler.ScheduleAndClaimAsync(
                    "fold-worker-second",
                    secondFoldInstant,
                    runSettings));
            }

            await using var verification = CreateTenantContext(database, graph.Tenant);
            var job = Assert.Single(await verification.TaskDeadlineDigestJobs.AsNoTracking().ToListAsync());
            Assert.Equal(graph.Tenant.Id, job.TenantId);
            Assert.Equal(graph.Workspace.Id, job.WorkspaceId);
            Assert.Equal(graph.User.Id, job.UserId);
            Assert.Equal(new DateOnly(2026, 11, 1), job.LocalDate);
            Assert.Equal(TaskDeadlineDigestPolicy.PolicyVersion, job.PolicyVersion);
            Assert.Equal(firstFoldInstant, job.ScheduledForUtc);
            Assert.Equal(TaskDeadlineDigestJobStatus.Claimed, job.Status);
            Assert.Equal(firstClaim.ClaimToken, job.ClaimToken);
            Assert.Equal(1, job.AttemptCount);
            Assert.Equal(1, job.AutomaticAttemptCount);
            Assert.Equal(1, await verification.TaskDeadlineDigestAttempts.CountAsync());
        });
    }

    [PostgreSqlFact]
    public async Task DstGapSchedulingUsesFirstValidInstantAndOnePostgreSqlLedgerIdentity()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();

        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedGraphAsync(database);
            await using (var settingsContext = CreateTenantContext(database, graph.Tenant))
            {
                var workspace = await settingsContext.Workspaces.SingleAsync(item => item.Id == graph.Workspace.Id);
                workspace.TimeZone = "America/New_York";
                workspace.DefaultTaskDeadlineDigestLocalTime = new TimeOnly(2, 30);
                await settingsContext.SaveChangesAsync();
            }

            var runSettings = new TaskDeadlineDigestRunSettings(
                SchedulePageSize: 25,
                ClaimBatchSize: 10,
                CandidatePageSize: 25,
                ClaimTimeout: TimeSpan.FromMinutes(2),
                RetryDelay: TimeSpan.FromMinutes(1));
            var beforeGapEnd = new DateTimeOffset(2026, 3, 8, 6, 59, 0, TimeSpan.Zero);
            var firstValidInstant = new DateTimeOffset(2026, 3, 8, 7, 0, 0, TimeSpan.Zero);

            await using (var beforeContext = CreateTenantContext(database, graph.Tenant))
            {
                var beforeTenant = TenantScope(graph.Tenant);
                var scheduler = new TaskDeadlineDigestScheduler(
                    new TaskDeadlineDigestRepository(beforeContext, beforeTenant),
                    EnabledFeatureFlags.Instance,
                    beforeTenant,
                    new TaskDeadlineDigestDiagnostics());
                Assert.Empty(await scheduler.ScheduleAndClaimAsync(
                    "gap-worker-before",
                    beforeGapEnd,
                    runSettings));
            }

            await using (var dueContext = CreateTenantContext(database, graph.Tenant))
            {
                var dueTenant = TenantScope(graph.Tenant);
                var scheduler = new TaskDeadlineDigestScheduler(
                    new TaskDeadlineDigestRepository(dueContext, dueTenant),
                    EnabledFeatureFlags.Instance,
                    dueTenant,
                    new TaskDeadlineDigestDiagnostics());
                Assert.Single(await scheduler.ScheduleAndClaimAsync(
                    "gap-worker-due",
                    firstValidInstant,
                    runSettings));
            }

            await using var verification = CreateTenantContext(database, graph.Tenant);
            var job = Assert.Single(await verification.TaskDeadlineDigestJobs.AsNoTracking().ToListAsync());
            Assert.Equal(new DateOnly(2026, 3, 8), job.LocalDate);
            Assert.Equal(firstValidInstant, job.ScheduledForUtc);
            Assert.Equal(TaskDeadlineDigestJobStatus.Claimed, job.Status);
            Assert.Equal(1, job.AttemptCount);
            Assert.Equal(1, await verification.TaskDeadlineDigestAttempts.CountAsync());
        });
    }

    [PostgreSqlFact]
    public async Task ConcurrentClaimSkipsLockedFirstRowAndClaimsEachJobOnce()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();

        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedGraphAsync(database);
            var firstJob = await InsertJobAsync(
                database,
                graph,
                new DateOnly(2026, 8, 2),
                TaskDeadlineDigestPolicy.PolicyVersion,
                Now.AddMinutes(-2));
            var secondJob = await InsertJobAsync(
                database,
                graph,
                new DateOnly(2026, 8, 3),
                TaskDeadlineDigestPolicy.PolicyVersion,
                Now.AddMinutes(-1));

            await using var lockConnection = new NpgsqlConnection(database);
            await lockConnection.OpenAsync();
            await using var lockTransaction = await lockConnection.BeginTransactionAsync();
            await using (var lockCommand = new NpgsqlCommand(
                             "SELECT \"Id\" FROM task_deadline_digest_jobs WHERE \"Id\" = @id FOR UPDATE;",
                             lockConnection,
                             lockTransaction))
            {
                lockCommand.Parameters.AddWithValue("id", firstJob.Id);
                Assert.Equal(firstJob.Id, (Guid?)await lockCommand.ExecuteScalarAsync());
            }

            await using (var workerContext = CreateTenantContext(database, graph.Tenant))
            {
                var workerTenant = TenantScope(graph.Tenant);
                var worker = new TaskDeadlineDigestRepository(workerContext, workerTenant);
                var claimedWhileLocked = await worker.ClaimDueAsync(
                    "worker-b",
                    Now,
                    batchSize: 1,
                    claimTimeout: TimeSpan.FromMinutes(2));

                Assert.Equal(secondJob.Id, Assert.Single(claimedWhileLocked).JobId);
            }

            await lockTransaction.CommitAsync();

            await using (var workerContext = CreateTenantContext(database, graph.Tenant))
            {
                var workerTenant = TenantScope(graph.Tenant);
                var worker = new TaskDeadlineDigestRepository(workerContext, workerTenant);
                var claimedAfterUnlock = await worker.ClaimDueAsync(
                    "worker-a",
                    Now,
                    batchSize: 1,
                    claimTimeout: TimeSpan.FromMinutes(2));

                Assert.Equal(firstJob.Id, Assert.Single(claimedAfterUnlock).JobId);
            }

            await using var verification = CreateTenantContext(database, graph.Tenant);
            var jobs = await verification.TaskDeadlineDigestJobs.AsNoTracking().ToListAsync();
            Assert.Equal(2, jobs.Count);
            Assert.All(jobs, job =>
            {
                Assert.Equal(TaskDeadlineDigestJobStatus.Claimed, job.Status);
                Assert.Equal(1, job.AttemptCount);
                Assert.Equal(1, job.AutomaticAttemptCount);
                Assert.NotNull(job.ClaimToken);
            });
            Assert.Equal(
                2,
                await verification.TaskDeadlineDigestAttempts.CountAsync(attempt =>
                    attempt.Status == TaskDeadlineDigestAttemptStatus.Claimed));
        });
    }

    [PostgreSqlFact]
    public async Task ExpiredClaimCreatesNewAttemptAndOldTokenCannotCompleteJob()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();

        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedGraphAsync(database);
            var job = await InsertJobAsync(
                database,
                graph,
                new DateOnly(2026, 8, 3),
                TaskDeadlineDigestPolicy.PolicyVersion,
                Now);

            TaskDeadlineDigestClaim originalClaim;
            await using (var firstContext = CreateTenantContext(database, graph.Tenant))
            {
                var firstTenant = TenantScope(graph.Tenant);
                var firstWorker = new TaskDeadlineDigestRepository(firstContext, firstTenant);
                originalClaim = Assert.Single(await firstWorker.ClaimDueAsync(
                    "worker-old",
                    Now,
                    batchSize: 1,
                    claimTimeout: TimeSpan.FromMinutes(1)));
            }

            var reclaimAt = Now.AddMinutes(2);
            TaskDeadlineDigestClaim replacementClaim;
            await using (var secondContext = CreateTenantContext(database, graph.Tenant))
            {
                var secondTenant = TenantScope(graph.Tenant);
                var secondWorker = new TaskDeadlineDigestRepository(secondContext, secondTenant);
                replacementClaim = Assert.Single(await secondWorker.ClaimDueAsync(
                    "worker-new",
                    reclaimAt,
                    batchSize: 1,
                    claimTimeout: TimeSpan.FromMinutes(2)));
            }

            Assert.Equal(job.Id, replacementClaim.JobId);
            Assert.NotEqual(originalClaim.ClaimToken, replacementClaim.ClaimToken);

            await using (var staleContext = CreateTenantContext(database, graph.Tenant))
            {
                var staleTenant = TenantScope(graph.Tenant);
                var staleWorker = new TaskDeadlineDigestRepository(staleContext, staleTenant);
                Assert.False(await staleWorker.MarkSucceededAsync(
                    job.Id,
                    originalClaim.ClaimToken,
                    notificationId: null,
                    completedAt: reclaimAt));
            }

            await using var verification = CreateTenantContext(database, graph.Tenant);
            var persistedJob = await verification.TaskDeadlineDigestJobs.AsNoTracking().SingleAsync();
            Assert.Equal(TaskDeadlineDigestJobStatus.Claimed, persistedJob.Status);
            Assert.Equal(replacementClaim.ClaimToken, persistedJob.ClaimToken);
            Assert.Equal(2, persistedJob.AttemptCount);
            Assert.Equal(2, persistedJob.AutomaticAttemptCount);
            var attempts = await verification.TaskDeadlineDigestAttempts.AsNoTracking()
                .OrderBy(attempt => attempt.AttemptNumber)
                .ToListAsync();
            Assert.Collection(
                attempts,
                expired =>
                {
                    Assert.Equal(TaskDeadlineDigestAttemptStatus.Expired, expired.Status);
                    Assert.Equal("DigestClaimExpired", expired.LastErrorCode);
                    Assert.NotNull(expired.CompletedAt);
                    Assert.Null(expired.ClaimToken);
                },
                claimed =>
                {
                    Assert.Equal(TaskDeadlineDigestAttemptStatus.Claimed, claimed.Status);
                    Assert.Equal(replacementClaim.ClaimToken, claimed.ClaimToken);
                });
        });
    }

    [PostgreSqlFact]
    public async Task ExactlyThirdAutomaticFailureIsTerminal()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();

        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedGraphAsync(database);
            var job = await InsertJobAsync(
                database,
                graph,
                new DateOnly(2026, 8, 3),
                TaskDeadlineDigestPolicy.PolicyVersion,
                Now);

            for (var attemptNumber = 1; attemptNumber <= TaskDeadlineDigestPolicy.MaximumAutomaticAttempts; attemptNumber++)
            {
                var attemptAt = Now.AddMinutes(attemptNumber - 1);
                await using var context = CreateTenantContext(database, graph.Tenant);
                var currentTenant = TenantScope(graph.Tenant);
                var repository = new TaskDeadlineDigestRepository(context, currentTenant);
                var claim = Assert.Single(await repository.ClaimDueAsync(
                    $"worker-{attemptNumber}",
                    attemptAt,
                    batchSize: 1,
                    claimTimeout: TimeSpan.FromMinutes(1)));
                Assert.Equal(TaskDeadlineDigestAttemptTrigger.Automatic, claim.Trigger);

                var transition = await repository.MarkFailureAsync(
                    job.Id,
                    claim.ClaimToken,
                    "DigestBuildFailed",
                    attemptAt,
                    attemptAt.AddMinutes(1));
                Assert.True(transition.Changed);
                Assert.Equal(attemptNumber == TaskDeadlineDigestPolicy.MaximumAutomaticAttempts, transition.Terminal);

                await using var verification = CreateTenantContext(database, graph.Tenant);
                var persisted = await verification.TaskDeadlineDigestJobs.AsNoTracking().SingleAsync();
                Assert.Equal(attemptNumber, persisted.AutomaticAttemptCount);
                Assert.Equal(attemptNumber, persisted.AttemptCount);
                Assert.Equal(
                    attemptNumber == TaskDeadlineDigestPolicy.MaximumAutomaticAttempts
                        ? TaskDeadlineDigestJobStatus.Failed
                        : TaskDeadlineDigestJobStatus.Pending,
                    persisted.Status);
                Assert.Equal(attemptNumber == TaskDeadlineDigestPolicy.MaximumAutomaticAttempts, persisted.CompletedAt.HasValue);
            }

            await using var finalVerification = CreateTenantContext(database, graph.Tenant);
            Assert.Equal(
                TaskDeadlineDigestPolicy.MaximumAutomaticAttempts,
                await finalVerification.TaskDeadlineDigestAttempts.CountAsync(attempt =>
                    attempt.Trigger == TaskDeadlineDigestAttemptTrigger.Automatic &&
                    attempt.Status == TaskDeadlineDigestAttemptStatus.Failed));
        });
    }

    [PostgreSqlFact]
    public async Task OperatorRestartAppendsAuditedAttemptWithoutResettingAutomaticAttempts()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();

        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedGraphAsync(database);
            var job = await InsertJobAsync(
                database,
                graph,
                new DateOnly(2026, 8, 3),
                TaskDeadlineDigestPolicy.PolicyVersion,
                Now);

            for (var attemptNumber = 1; attemptNumber <= TaskDeadlineDigestPolicy.MaximumAutomaticAttempts; attemptNumber++)
            {
                var attemptAt = Now.AddMinutes(attemptNumber - 1);
                await using var context = CreateTenantContext(database, graph.Tenant);
                var currentTenant = TenantScope(graph.Tenant);
                var repository = new TaskDeadlineDigestRepository(context, currentTenant);
                var claim = Assert.Single(await repository.ClaimDueAsync(
                    $"automatic-{attemptNumber}",
                    attemptAt,
                    batchSize: 1,
                    claimTimeout: TimeSpan.FromMinutes(1)));
                _ = await repository.MarkFailureAsync(
                    job.Id,
                    claim.ClaimToken,
                    "DigestBuildFailed",
                    attemptAt,
                    attemptAt.AddMinutes(1));
            }

            Guid[] originalAttemptIds;
            await using (var beforeRestart = CreateTenantContext(database, graph.Tenant))
            {
                originalAttemptIds = await beforeRestart.TaskDeadlineDigestAttempts.AsNoTracking()
                    .OrderBy(attempt => attempt.AttemptNumber)
                    .Select(attempt => attempt.Id)
                    .ToArrayAsync();
            }

            var requestedAt = Now.AddMinutes(5);
            await using (var restartContext = CreateTenantContext(database, graph.Tenant))
            {
                var restartTenant = TenantScope(graph.Tenant);
                var repository = new TaskDeadlineDigestRepository(restartContext, restartTenant);
                Assert.Equal(
                    TaskDeadlineDigestRestartOutcome.Restarted,
                    await repository.RestartFailedAsync(
                        job.Id,
                        graph.User.Id,
                        "Operator verified a transient dependency outage.",
                        requestedAt));
            }

            Guid restartAttemptId;
            await using (var afterRestart = CreateTenantContext(database, graph.Tenant))
            {
                var persisted = await afterRestart.TaskDeadlineDigestJobs.AsNoTracking().SingleAsync();
                Assert.Equal(TaskDeadlineDigestJobStatus.Pending, persisted.Status);
                Assert.Equal(TaskDeadlineDigestPolicy.MaximumAutomaticAttempts, persisted.AutomaticAttemptCount);
                Assert.Equal(TaskDeadlineDigestPolicy.MaximumAutomaticAttempts, persisted.AttemptCount);
                Assert.Equal(TaskDeadlineDigestPolicy.MaximumAutomaticAttempts + 1, persisted.AttemptSequence);
                Assert.Equal(requestedAt, persisted.NextAttemptAt);

                var attempts = await afterRestart.TaskDeadlineDigestAttempts.AsNoTracking()
                    .OrderBy(attempt => attempt.AttemptNumber)
                    .ToListAsync();
                Assert.Equal(originalAttemptIds, attempts.Take(3).Select(attempt => attempt.Id));
                var restart = Assert.Single(
                    attempts,
                    attempt => attempt.Trigger == TaskDeadlineDigestAttemptTrigger.OperatorRestart);
                restartAttemptId = restart.Id;
                Assert.Equal(TaskDeadlineDigestAttemptStatus.Pending, restart.Status);
                Assert.Equal(originalAttemptIds[^1], restart.RestartedFromAttemptId);
                Assert.Equal(graph.User.Id, restart.RequestedByUserId);

                var audit = await afterRestart.AuditLogs.AsNoTracking().SingleAsync(log =>
                    log.Action == "TaskDeadlineDigestRestarted" && log.EntityId == job.Id);
                Assert.Equal(graph.User.Id, audit.ActorUserId);
                Assert.Equal(job.WorkspaceId, audit.WorkspaceId);
            }

            await using (var claimContext = CreateTenantContext(database, graph.Tenant))
            {
                var claimTenant = TenantScope(graph.Tenant);
                var repository = new TaskDeadlineDigestRepository(claimContext, claimTenant);
                var operatorClaim = Assert.Single(await repository.ClaimDueAsync(
                    "operator-restart-worker",
                    requestedAt,
                    batchSize: 1,
                    claimTimeout: TimeSpan.FromMinutes(1)));
                Assert.Equal(TaskDeadlineDigestAttemptTrigger.OperatorRestart, operatorClaim.Trigger);
                Assert.True(await repository.DeferAsync(
                    job.Id,
                    operatorClaim.ClaimToken,
                    requestedAt.AddMinutes(15),
                    requestedAt));
            }

            await using (var deferredVerification = CreateTenantContext(database, graph.Tenant))
            {
                var deferredJob = await deferredVerification.TaskDeadlineDigestJobs.AsNoTracking().SingleAsync();
                Assert.Equal(TaskDeadlineDigestJobStatus.Pending, deferredJob.Status);
                Assert.Equal(TaskDeadlineDigestPolicy.MaximumAutomaticAttempts, deferredJob.AttemptCount);
                Assert.Equal(TaskDeadlineDigestPolicy.MaximumAutomaticAttempts, deferredJob.AutomaticAttemptCount);
                Assert.Equal(requestedAt.AddMinutes(15), deferredJob.NextAttemptAt);
                var deferredRestart = await deferredVerification.TaskDeadlineDigestAttempts.AsNoTracking()
                    .SingleAsync(attempt => attempt.Id == restartAttemptId);
                Assert.Equal(TaskDeadlineDigestAttemptStatus.Pending, deferredRestart.Status);
                Assert.Null(deferredRestart.CompletedAt);
                Assert.Null(deferredRestart.ClaimToken);
            }

            await using (var reclaimContext = CreateTenantContext(database, graph.Tenant))
            {
                var reclaimTenant = TenantScope(graph.Tenant);
                var repository = new TaskDeadlineDigestRepository(reclaimContext, reclaimTenant);
                var operatorReclaim = Assert.Single(await repository.ClaimDueAsync(
                    "operator-restart-worker-later",
                    requestedAt.AddMinutes(15),
                    batchSize: 1,
                    claimTimeout: TimeSpan.FromMinutes(1)));
                Assert.Equal(TaskDeadlineDigestAttemptTrigger.OperatorRestart, operatorReclaim.Trigger);
            }

            await using var finalVerification = CreateTenantContext(database, graph.Tenant);
            var finalJob = await finalVerification.TaskDeadlineDigestJobs.AsNoTracking().SingleAsync();
            Assert.Equal(TaskDeadlineDigestPolicy.MaximumAutomaticAttempts, finalJob.AutomaticAttemptCount);
            Assert.Equal(TaskDeadlineDigestPolicy.MaximumAutomaticAttempts + 1, finalJob.AttemptCount);
            Assert.Equal(4, await finalVerification.TaskDeadlineDigestAttempts.CountAsync());
            Assert.Equal(TaskDeadlineDigestAttemptStatus.Claimed,
                (await finalVerification.TaskDeadlineDigestAttempts.AsNoTracking()
                    .SingleAsync(attempt => attempt.Id == restartAttemptId)).Status);
            Assert.Equal(1, await finalVerification.AuditLogs.CountAsync(log =>
                log.Action == "TaskDeadlineDigestRestarted" && log.EntityId == job.Id));
        });
    }

    private static Task<bool> TableExistsAsync(string connectionString, string tableName) =>
        PostgreSqlMigrationTestDatabase.ScalarAsync<bool>(
            connectionString,
            "SELECT to_regclass(@tableName) IS NOT NULL;",
            ("tableName", $"public.{tableName}"));

    private static Task<bool> MigrationAppliedAsync(string connectionString, string migration) =>
        PostgreSqlMigrationTestDatabase.ScalarAsync<bool>(
            connectionString,
            "SELECT EXISTS (SELECT 1 FROM \"__EFMigrationsHistory\" WHERE \"MigrationId\" = @migration);",
            ("migration", migration));

    private static async Task<string> ExplainAsync(
        string connectionString,
        string sql,
        params (string Name, object? Value)[] parameters)
    {
        var lines = await PostgreSqlMigrationTestDatabase.QueryAsync(
            connectionString,
            sql,
            reader => reader.GetString(0),
            parameters);
        return string.Join(Environment.NewLine, lines);
    }

    private static async Task SeedLedgerPlanRowsAsync(string connectionString, DigestGraph graph)
    {
        await PostgreSqlMigrationTestDatabase.ExecuteAsync(
            connectionString,
            """
            INSERT INTO task_deadline_digest_jobs
                ("Id", "TenantId", "WorkspaceId", "UserId", "LocalDate", "PolicyVersion",
                 "Status", "AttemptCount", "AutomaticAttemptCount", "AttemptSequence",
                 "ScheduledForUtc", "NextAttemptAt", "CreatedAt", "UpdatedAt")
            SELECT gen_random_uuid(), @tenantId, @workspaceId, @userId, DATE '2026-08-03', series.value,
                   'Pending', 0, 0, 0,
                   @now, @now - (series.value * INTERVAL '1 second'),
                   @now - (series.value * INTERVAL '1 millisecond'), NULL
            FROM generate_series(1, 4000) AS series(value);

            INSERT INTO task_deadline_digest_jobs
                ("Id", "TenantId", "WorkspaceId", "UserId", "LocalDate", "PolicyVersion",
                 "Status", "AttemptCount", "AutomaticAttemptCount", "AttemptSequence",
                 "ScheduledForUtc", "NextAttemptAt", "ClaimOwner", "ClaimToken", "ClaimedAt",
                 "ClaimExpiresAt", "CreatedAt", "UpdatedAt")
            SELECT gen_random_uuid(), @tenantId, @workspaceId, @userId, DATE '2026-08-03', 10000 + series.value,
                   'Claimed', 1, 1, 1,
                   @now, NULL, 'explain-worker', gen_random_uuid(), @now - INTERVAL '2 hours',
                   @now - (series.value * INTERVAL '1 second'),
                   @now - (series.value * INTERVAL '1 millisecond'), NULL
            FROM generate_series(1, 4000) AS series(value);

            ANALYZE task_deadline_digest_jobs;
            """,
            ("tenantId", graph.Tenant.Id),
            ("workspaceId", graph.Workspace.Id),
            ("userId", graph.User.Id),
            ("now", Now));
    }

    private static async Task<Guid[]> SeedCandidateTasksAsync(string connectionString, DigestGraph graph)
    {
        await using var context = CreateTenantContext(connectionString, graph.Tenant);
        var suffix = Guid.NewGuid().ToString("N");
        var project = new Project
        {
            TenantId = graph.Tenant.Id,
            WorkspaceId = graph.Workspace.Id,
            OwnerUserId = graph.User.Id,
            CreatedByUserId = graph.User.Id,
            Name = "PR07-C candidate project",
            Slug = $"pr07c-candidates-{suffix}",
            Status = ProjectStatus.Active,
            VersionNo = 1
        };
        context.Projects.Add(project);
        await context.SaveChangesAsync();

        var tasks = Enumerable.Range(1, 5)
            .Select(index => new TaskItem
            {
                TenantId = graph.Tenant.Id,
                WorkspaceId = graph.Workspace.Id,
                ProjectId = project.Id,
                CreatedByUserId = graph.User.Id,
                Title = $"PR07-C candidate {index}",
                Status = TaskItemStatus.NotStarted,
                Kind = WorkItemKind.Task,
                DeadlineAt = Now.AddHours(index),
                VersionNo = 1
            })
            .ToArray();
        context.TaskItems.AddRange(tasks);
        await context.SaveChangesAsync();
        return tasks.OrderBy(task => task.DeadlineAt).ThenBy(task => task.Id).Select(task => task.Id).ToArray();
    }

    private static async Task<TaskDeadlineDigestJob> InsertJobAsync(
        string connectionString,
        DigestGraph graph,
        DateOnly localDate,
        int policyVersion,
        DateTimeOffset scheduledForUtc)
    {
        await using var context = CreateTenantContext(connectionString, graph.Tenant);
        var job = NewJob(graph, localDate, policyVersion, scheduledForUtc);
        context.TaskDeadlineDigestJobs.Add(job);
        await context.SaveChangesAsync();
        return job;
    }

    private static TaskDeadlineDigestJob NewJob(
        DigestGraph graph,
        DateOnly localDate,
        int policyVersion,
        DateTimeOffset scheduledForUtc) =>
        new()
        {
            TenantId = graph.Tenant.Id,
            WorkspaceId = graph.Workspace.Id,
            UserId = graph.User.Id,
            LocalDate = localDate,
            PolicyVersion = policyVersion,
            Status = TaskDeadlineDigestJobStatus.Pending,
            ScheduledForUtc = scheduledForUtc,
            NextAttemptAt = scheduledForUtc
        };

    private static async Task<DigestGraph> SeedGraphAsync(string connectionString)
    {
        var suffix = Guid.NewGuid().ToString("N");
        var tenant = new Tenant
        {
            Name = $"PR07-C {suffix}",
            DisplayName = "PR07-C digest",
            Slug = $"pr07c-digest-{suffix}",
            Status = TenantStatus.Active
        };
        var user = new User
        {
            DisplayName = "PR07-C operator",
            Email = $"pr07c-{suffix}@example.test",
            NormalizedEmail = $"PR07C-{suffix}@EXAMPLE.TEST",
            PasswordHash = "hash",
            Status = UserStatus.Active
        };

        await using (var platform = PostgreSqlMigrationTestDatabase.CreatePlatformContext(connectionString))
        {
            platform.AddRange(tenant, user);
            await platform.SaveChangesAsync();
        }

        var workspace = new Workspace
        {
            TenantId = tenant.Id,
            Name = "PR07-C Workspace",
            Slug = $"pr07c-workspace-{suffix}",
            TimeZone = "UTC",
            Status = WorkspaceStatus.Active,
            CreatedByUserId = user.Id
        };
        await using (var tenantContext = CreateTenantContext(connectionString, tenant))
        {
            tenantContext.AddRange(
                workspace,
                new TenantUser
                {
                    TenantId = tenant.Id,
                    UserId = user.Id,
                    Role = TenantUserRole.Member,
                    Status = TenantUserStatus.Active,
                    JoinedAt = Now
                },
                new WorkspaceMember
                {
                    TenantId = tenant.Id,
                    WorkspaceId = workspace.Id,
                    UserId = user.Id,
                    Role = WorkspaceRole.Owner,
                    Status = MembershipStatus.Active,
                    JoinedAt = Now
                });
            await tenantContext.SaveChangesAsync();
        }

        return new DigestGraph(tenant, workspace, user);
    }

    private static AppDbContext CreateTenantContext(
        string connectionString,
        Tenant tenant,
        params IInterceptor[] interceptors)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(connectionString);
        if (interceptors.Length > 0)
            options.AddInterceptors(interceptors);
        return new AppDbContext(options.Options, TenantScope(tenant));
    }

    private static CurrentTenantService TenantScope(Tenant tenant)
    {
        var currentTenant = new CurrentTenantService();
        currentTenant.SetTenant(tenant.Id, tenant.Slug);
        return currentTenant;
    }

    private static string NormalizeSql(string sql) =>
        string.Join(' ', sql.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));

    private sealed class CandidateCommandInterceptor : DbCommandInterceptor
    {
        public List<ObservedCommand> Commands { get; } = [];

        public void Clear() => Commands.Clear();

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("task_deadline_digest_jobs", StringComparison.OrdinalIgnoreCase) &&
                command.CommandText.Contains("task_items", StringComparison.OrdinalIgnoreCase) &&
                command.CommandText.Contains("DeadlineAt", StringComparison.Ordinal))
            {
                Commands.Add(new ObservedCommand(
                    command.CommandText,
                    command.Parameters
                        .Cast<DbParameter>()
                        .Select(parameter => parameter.Value)
                        .OfType<int>()
                        .ToArray()));
            }

            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }
    }

    private sealed record ObservedCommand(string CommandText, IReadOnlyList<int> IntegerParameterValues);

    private sealed class EnabledFeatureFlags : IFeatureFlagService
    {
        public static readonly EnabledFeatureFlags Instance = new();

        public Task<bool> IsEnabledAsync(
            string featureKey,
            CancellationToken cancellationToken = default) =>
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

    private sealed record DigestGraph(Tenant Tenant, Workspace Workspace, User User);
}
