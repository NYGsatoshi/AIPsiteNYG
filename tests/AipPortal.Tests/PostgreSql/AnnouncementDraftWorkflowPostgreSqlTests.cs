using AipPortal.Application.Common.Tenancy;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Tests.PostgreSql;

[Collection("PostgreSqlTaskV1")]
[Trait("Scope", "Issue378")]
public sealed class AnnouncementDraftWorkflowPostgreSqlTests
{
    private const string PreviousMigration = "20260829173340_AddMessageFollowUps";

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task MigrationCreatesRestrictiveDurableDraftStoreAndSupportsDownAndReapply()
    {
        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(
            PostgreSqlTestEnvironment.RequireConnectionString(),
            async database =>
            {
                await PostgreSqlMigrationTestDatabase.MigrateAsync(database, PreviousMigration);
                Assert.Equal(0L, await TableCountAsync(database));

                await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
                Assert.Equal(1L, await TableCountAsync(database));
                Assert.Equal(1L, await LocalScheduleColumnCountAsync(database));
                Assert.Equal(1L, await DueClaimIndexCountAsync(database));
                Assert.Equal(3L, await RestrictiveParentForeignKeyCountAsync(database));
                await using (var current = PostgreSqlMigrationTestDatabase.CreatePlatformContext(database))
                {
                    Assert.Empty(await current.Database.GetPendingMigrationsAsync());
                }

                await PostgreSqlMigrationTestDatabase.MigrateAsync(database, PreviousMigration);
                Assert.Equal(0L, await TableCountAsync(database));
                await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
                Assert.Equal(1L, await TableCountAsync(database));
            });
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task ConcurrentDueClaimsLeaveOneVersionFencedLease()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
        var seedTenant = new CurrentTenantService();
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(connectionString)
            .Options;
        await using var seed = new AppDbContext(options, seedTenant);
        Assert.Empty(await seed.Database.GetPendingMigrationsAsync());

        var runId = Guid.NewGuid().ToString("N");
        var now = new DateTimeOffset(2026, 8, 30, 1, 0, 0, TimeSpan.Zero);
        var tenant = new Tenant
        {
            Name = $"Announcement draft {runId}",
            DisplayName = "Announcement draft",
            Slug = $"announcement-draft-{runId}",
            Status = TenantStatus.Active
        };
        var author = new User
        {
            DisplayName = "Announcement author",
            Email = $"announcement-author-{runId}@example.test",
            NormalizedEmail = $"ANNOUNCEMENT-AUTHOR-{runId}@EXAMPLE.TEST",
            Status = UserStatus.Active
        };

        seedTenant.SetPlatformScope();
        seed.Tenants.Add(tenant);
        seed.Users.Add(author);
        await seed.SaveChangesAsync();

        seedTenant.SetTenant(tenant.Id, tenant.Slug);
        var workspace = new Workspace
        {
            Name = "Announcement draft workspace",
            Slug = $"announcement-draft-workspace-{runId}",
            CreatedByUserId = author.Id,
            Status = WorkspaceStatus.Active
        };
        seed.Workspaces.Add(workspace);
        seed.TenantUsers.Add(new TenantUser
        {
            UserId = author.Id,
            Status = TenantUserStatus.Active,
            JoinedAt = now
        });
        await seed.SaveChangesAsync();

        var draft = new AnnouncementDraft
        {
            TenantId = tenant.Id,
            AuthorUserId = author.Id,
            WorkspaceId = workspace.Id,
            Title = "Version-fenced due announcement",
            Body = "A durable due claim must have one winning worker.",
            Status = AnnouncementDraftStatus.Scheduled,
            VersionNo = 1,
            ScheduledForUtc = now,
            ScheduleTimeZoneId = "UTC",
            ScheduleLocalDateTime = new DateTime(2026, 8, 30, 1, 0, 0, DateTimeKind.Unspecified),
            NextPublicationAttemptAtUtc = now
        };
        seed.AnnouncementDrafts.Add(draft);
        await seed.SaveChangesAsync();

        var tenantOne = new CurrentTenantService();
        var tenantTwo = new CurrentTenantService();
        tenantOne.SetTenant(tenant.Id, tenant.Slug);
        tenantTwo.SetTenant(tenant.Id, tenant.Slug);
        await using var contextOne = new AppDbContext(options, tenantOne);
        await using var contextTwo = new AppDbContext(options, tenantTwo);
        var repositoryOne = new AnnouncementDraftRepository(contextOne, tenantOne);
        var repositoryTwo = new AnnouncementDraftRepository(contextTwo, tenantTwo);

        var claims = await Task.WhenAll(
            repositoryOne.ClaimDueAsync("announcement-worker-one", now, 10, TimeSpan.FromMinutes(2)),
            repositoryTwo.ClaimDueAsync("announcement-worker-two", now, 10, TimeSpan.FromMinutes(2)));

        Assert.Single(claims.SelectMany(items => items));
        seed.ChangeTracker.Clear();
        var persisted = await seed.AnnouncementDrafts.SingleAsync(item => item.Id == draft.Id);
        Assert.NotNull(persisted.PublicationClaimToken);
        Assert.Equal(2, persisted.VersionNo);
        Assert.Contains(persisted.PublicationClaimOwner, new[] { "announcement-worker-one", "announcement-worker-two" });
    }

    private static Task<long> TableCountAsync(string database) =>
        PostgreSqlMigrationTestDatabase.ScalarAsync<long>(
            database,
            """
            SELECT COUNT(*)
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'announcement_drafts'
            """);

    private static Task<long> LocalScheduleColumnCountAsync(string database) =>
        PostgreSqlMigrationTestDatabase.ScalarAsync<long>(
            database,
            """
            SELECT COUNT(*)
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'announcement_drafts'
              AND column_name = 'ScheduleLocalDateTime'
              AND data_type = 'timestamp without time zone'
            """);

    private static Task<long> DueClaimIndexCountAsync(string database) =>
        PostgreSqlMigrationTestDatabase.ScalarAsync<long>(
            database,
            """
            SELECT COUNT(*)
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename = 'announcement_drafts'
              AND indexname = 'IX_announcement_drafts_TenantId_Status_ScheduledForUtc_NextPub~'
            """);

    private static Task<long> RestrictiveParentForeignKeyCountAsync(string database) =>
        PostgreSqlMigrationTestDatabase.ScalarAsync<long>(
            database,
            """
            SELECT COUNT(*)
            FROM pg_constraint
            WHERE conrelid = 'announcement_drafts'::regclass
              AND contype = 'f'
              AND confrelid IN ('workspaces'::regclass, 'groups'::regclass, 'channels'::regclass)
              AND confdeltype = 'r'
            """);
}
