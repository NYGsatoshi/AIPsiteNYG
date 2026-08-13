using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Application.Realtime;
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
    public async Task ConcurrentRetryCommitsOneLogicalWorkspaceAndOneSideEffectSet()
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

            await using (var failing = CreateServiceScope(database, graph, new ThrowingAuthorizationChanges()))
            {
                await Assert.ThrowsAsync<InvalidOperationException>(() =>
                    failing.Service.CreateAsync(request, "wpc01-rollback-key"));
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
    public async Task DuplicateDisplayNamesPersistWithDistinctBoundedSlugs()
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

    private static async Task AssertCreationCountsAsync(
        string connectionString,
        AuthorityGraph graph,
        int expected)
    {
        await using var verification = CreateTenantContext(connectionString, graph.TenantId, graph.TenantSlug);
        Assert.Equal(expected, await verification.Workspaces.CountAsync());
        Assert.Equal(expected, await verification.WorkspaceMembers.CountAsync());
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

    private static ServiceScope CreateServiceScope(
        string connectionString,
        AuthorityGraph graph,
        IAuthorizationStateChangePublisher? authorizationChanges = null)
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
            new EfCreateIdempotencyCoordinator(db));
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

    private sealed record ServiceScope(AppDbContext Db, WorkspaceService Service) : IAsyncDisposable
    {
        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }

    private sealed class TestCurrentUser(Guid userId) : ICurrentUser
    {
        public Guid? UserId => userId;
        public Guid? SessionId => Guid.NewGuid();
        public string? Email => "wpc-owner@example.test";
        public SystemRole? SystemRole => AipPortal.Domain.Enums.SystemRole.NormalUser;
        public bool IsAuthenticated => true;
    }

    private sealed class TestClock : IClock
    {
        public static DateTimeOffset Value { get; } = new(2026, 8, 13, 0, 0, 0, TimeSpan.Zero);
        public DateTimeOffset UtcNow => Value;
    }

    private sealed class ThrowingAuthorizationChanges : IAuthorizationStateChangePublisher
    {
        public Task PublishAsync(
            Guid tenantId,
            Guid affectedUserId,
            string scopeType,
            Guid? scopeId,
            string change,
            CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("Required invalidation staging failed.");
    }
}
