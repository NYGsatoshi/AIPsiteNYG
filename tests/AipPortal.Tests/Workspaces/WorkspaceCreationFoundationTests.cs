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

namespace AipPortal.Tests.Workspaces;

public sealed class WorkspaceCreationFoundationTests
{
    [Theory]
    [InlineData(TenantUserRole.Owner, TenantUserStatus.Active, UserStatus.Active, true)]
    [InlineData(TenantUserRole.Admin, TenantUserStatus.Active, UserStatus.Active, true)]
    [InlineData(TenantUserRole.Member, TenantUserStatus.Active, UserStatus.Active, false)]
    [InlineData(TenantUserRole.Owner, TenantUserStatus.Suspended, UserStatus.Active, false)]
    [InlineData(TenantUserRole.Admin, TenantUserStatus.Active, UserStatus.Suspended, false)]
    public async Task WorkspaceCreateAuthorityUsesCurrentTenantMembership(
        TenantUserRole role,
        TenantUserStatus membershipStatus,
        UserStatus userStatus,
        bool expected)
    {
        await using var fixture = await Fixture.CreateAsync(role, membershipStatus, userStatus);

        var allowed = await fixture.Authorization.CanCreateWorkspace(fixture.Actor.Id, fixture.Tenant.Id);

        Assert.Equal(expected, allowed);
    }

    [Fact]
    public async Task PlatformAdministratorHasNoUndocumentedWorkspaceCreateBypass()
    {
        await using var fixture = await Fixture.CreateAsync(
            TenantUserRole.Member,
            TenantUserStatus.Active,
            UserStatus.Active,
            SystemRole.PlatformAdmin);

        var allowed = await fixture.Authorization.CanCreateWorkspace(fixture.Actor.Id, fixture.Tenant.Id);

        Assert.False(allowed);
    }

    [Fact]
    public async Task InactiveTenantOwnerCannotCreateWorkspace()
    {
        await using var fixture = await Fixture.CreateAsync(
            TenantUserRole.Owner,
            TenantUserStatus.Active,
            UserStatus.Active,
            tenantStatus: TenantStatus.Suspended);

        var allowed = await fixture.Authorization.CanCreateWorkspace(fixture.Actor.Id, fixture.Tenant.Id);

        Assert.False(allowed);
    }

    [Fact]
    public async Task CrossTenantCreateAuthorityIsDenied()
    {
        await using var fixture = await Fixture.CreateAsync(
            TenantUserRole.Owner,
            TenantUserStatus.Active,
            UserStatus.Active);

        var allowed = await fixture.Authorization.CanCreateWorkspace(fixture.Actor.Id, Guid.NewGuid());

        Assert.False(allowed);
    }

    [Fact]
    public async Task OrdinaryTenantMemberReceivesFalseCapabilityAndCannotCreate()
    {
        await using var fixture = await Fixture.CreateAsync(
            TenantUserRole.Member,
            TenantUserStatus.Active,
            UserStatus.Active);
        var service = fixture.CreateService();

        var capability = await service.GetCapabilitiesAsync();
        var create = await service.CreateAsync(
            new CreateWorkspaceRequest("Denied", null, null),
            "denied-create-key");

        Assert.True(capability.IsSuccess);
        Assert.False(capability.Value!.CanCreate);
        Assert.False(create.IsSuccess);
        Assert.Equal("CapabilityDenied", create.ErrorDetail?.Code);
        Assert.Empty(await fixture.Db.Workspaces.AsNoTracking().ToListAsync());
        Assert.Empty(await fixture.Db.IdempotencyRecords.AsNoTracking().ToListAsync());
    }

    [Fact]
    public async Task CreateAndReplayCommitOneOwnerAuditInvalidationAndIdempotencyRecord()
    {
        await using var fixture = await Fixture.CreateAsync(
            TenantUserRole.Owner,
            TenantUserStatus.Active,
            UserStatus.Active);
        var service = fixture.CreateService();
        var request = new CreateWorkspaceRequest("  Production  ", "  Foundation  ", "  🚀  ");

        var capability = await service.GetCapabilitiesAsync();
        var first = await service.CreateAsync(request, "workspace-create-001");
        fixture.Db.ChangeTracker.Clear();
        var replay = await service.CreateAsync(request, "workspace-create-001");

        Assert.True(capability.IsSuccess);
        Assert.True(capability.Value!.CanCreate);
        Assert.True(first.IsSuccess);
        Assert.True(replay.IsSuccess);
        Assert.Equal(first.Value!.Id, replay.Value!.Id);
        Assert.Equal("Production", first.Value.Name);
        Assert.Equal("Foundation", first.Value.Description);
        Assert.Equal("🚀", first.Value.Icon);

        var workspace = Assert.Single(await fixture.Db.Workspaces.AsNoTracking().ToListAsync());
        var owner = Assert.Single(await fixture.Db.WorkspaceMembers.AsNoTracking().ToListAsync());
        Assert.Equal(workspace.Id, owner.WorkspaceId);
        Assert.Equal(fixture.Actor.Id, owner.UserId);
        Assert.Equal(WorkspaceRole.Owner, owner.Role);
        Assert.Equal(MembershipStatus.Active, owner.Status);
        var idempotency = Assert.Single(await fixture.Db.IdempotencyRecords.AsNoTracking().ToListAsync());
        Assert.Equal(64, idempotency.KeyHash.Length);
        Assert.Equal(64, idempotency.RequestHash.Length);
        Assert.DoesNotContain("workspace-create-001", idempotency.KeyHash, StringComparison.Ordinal);
        Assert.Single(await fixture.Db.AuditLogs.AsNoTracking().Where(item => item.Action == "WorkspaceCreated").ToListAsync());
        Assert.Single(await fixture.Db.OutboxEvents.AsNoTracking().Where(item => item.EventType == "Security.AuthorizationStateChanged.v1").ToListAsync());
    }

    [Fact]
    public async Task ReusedIdentityWithDifferentRequestConflictsWithoutSideEffects()
    {
        await using var fixture = await Fixture.CreateAsync(
            TenantUserRole.Admin,
            TenantUserStatus.Active,
            UserStatus.Active);
        var service = fixture.CreateService();

        var first = await service.CreateAsync(
            new CreateWorkspaceRequest("First", null, null),
            "workspace-create-002");
        fixture.Db.ChangeTracker.Clear();
        var mismatch = await service.CreateAsync(
            new CreateWorkspaceRequest("Different", null, null),
            "workspace-create-002");

        Assert.True(first.IsSuccess);
        Assert.False(mismatch.IsSuccess);
        Assert.Equal("IdempotencyConflict", mismatch.ErrorDetail?.Code);
        Assert.Single(await fixture.Db.Workspaces.AsNoTracking().ToListAsync());
        Assert.Single(await fixture.Db.WorkspaceMembers.AsNoTracking().ToListAsync());
        Assert.Single(await fixture.Db.IdempotencyRecords.AsNoTracking().ToListAsync());
        Assert.Single(await fixture.Db.AuditLogs.AsNoTracking().Where(item => item.Action == "WorkspaceCreated").ToListAsync());
        Assert.Single(await fixture.Db.OutboxEvents.AsNoTracking().ToListAsync());
    }

    [Fact]
    public async Task DuplicateDisplayNamesReceiveDistinctBoundedDeterministicSlugs()
    {
        await using var fixture = await Fixture.CreateAsync(
            TenantUserRole.Owner,
            TenantUserStatus.Active,
            UserStatus.Active);
        var service = fixture.CreateService();
        var longName = new string('A', 160);

        var first = await service.CreateAsync(
            new CreateWorkspaceRequest(longName, null, null),
            "duplicate-name-1");
        fixture.Db.ChangeTracker.Clear();
        var second = await service.CreateAsync(
            new CreateWorkspaceRequest(longName, null, null),
            "duplicate-name-2");

        Assert.True(first.IsSuccess);
        Assert.True(second.IsSuccess);
        var workspaces = await fixture.Db.Workspaces.AsNoTracking().OrderBy(item => item.Id).ToListAsync();
        Assert.Equal(2, workspaces.Count);
        Assert.All(workspaces, item => Assert.True(item.Slug.Length <= 120));
        Assert.Equal(2, workspaces.Select(item => item.Slug).Distinct(StringComparer.Ordinal).Count());
        Assert.All(workspaces, item => Assert.EndsWith(item.Id.ToString("N"), item.Slug, StringComparison.Ordinal));
    }

    [Fact]
    public async Task AnotherActorMayReuseIdentityButCannotReceiveTheEarlierResource()
    {
        await using var fixture = await Fixture.CreateAsync(
            TenantUserRole.Owner,
            TenantUserStatus.Active,
            UserStatus.Active);
        var first = await fixture.CreateService().CreateAsync(
            new CreateWorkspaceRequest("Actor One", null, null),
            "shared-client-key");

        var secondActor = await fixture.AddActorAsync(
            TenantUserRole.Admin,
            TenantUserStatus.Active,
            "second@example.test");
        fixture.Db.ChangeTracker.Clear();
        var second = await fixture.CreateService(secondActor).CreateAsync(
            new CreateWorkspaceRequest("Actor Two", null, null),
            "shared-client-key");

        Assert.True(first.IsSuccess);
        Assert.True(second.IsSuccess);
        Assert.NotEqual(first.Value!.Id, second.Value!.Id);
        Assert.Equal(2, await fixture.Db.IdempotencyRecords.AsNoTracking().CountAsync());
        Assert.Equal(2, await fixture.Db.Workspaces.AsNoTracking().CountAsync());
        Assert.Equal(2, await fixture.Db.WorkspaceMembers.AsNoTracking().CountAsync());
    }

    [Fact]
    public async Task AnotherTenantMayReuseIdentityButCannotReceiveTheEarlierResource()
    {
        await using var fixture = await Fixture.CreateAsync(
            TenantUserRole.Owner,
            TenantUserStatus.Active,
            UserStatus.Active);
        var request = new CreateWorkspaceRequest("Tenant Scoped", null, null);
        var first = await fixture.CreateService().CreateAsync(request, "tenant-shared-key");

        var secondTenant = await fixture.AddTenantForActorAsync();
        fixture.Db.ChangeTracker.Clear();
        fixture.CurrentTenant.SetTenant(secondTenant.Id, secondTenant.Slug);
        var second = await fixture.CreateService().CreateAsync(request, "tenant-shared-key");

        Assert.True(first.IsSuccess);
        Assert.True(second.IsSuccess);
        Assert.NotEqual(first.Value!.Id, second.Value!.Id);
        fixture.CurrentTenant.SetPlatformScope();
        Assert.Equal(2, await fixture.Db.IdempotencyRecords.IgnoreQueryFilters().CountAsync());
        Assert.Equal(2, await fixture.Db.Workspaces.IgnoreQueryFilters().CountAsync());
        Assert.Equal(2, await fixture.Db.WorkspaceMembers.IgnoreQueryFilters().CountAsync());
    }

    [Fact]
    public async Task RequiredInitializationFailureLeavesNoReplayOrPartialWorkspace()
    {
        await using var fixture = await Fixture.CreateAsync(
            TenantUserRole.Owner,
            TenantUserStatus.Active,
            UserStatus.Active);
        var failing = fixture.CreateService(authorizationChanges: new ThrowingAuthorizationChanges());
        var request = new CreateWorkspaceRequest("Rollback", null, null);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            failing.CreateAsync(request, "workspace-create-rollback"));

        Assert.Empty(await fixture.Db.Workspaces.AsNoTracking().ToListAsync());
        Assert.Empty(await fixture.Db.WorkspaceMembers.AsNoTracking().ToListAsync());
        Assert.Empty(await fixture.Db.IdempotencyRecords.AsNoTracking().ToListAsync());
        Assert.Empty(await fixture.Db.AuditLogs.AsNoTracking().ToListAsync());
        Assert.Empty(await fixture.Db.OutboxEvents.AsNoTracking().ToListAsync());

        var retry = await fixture.CreateService().CreateAsync(request, "workspace-create-rollback");
        Assert.True(retry.IsSuccess);
        Assert.Single(await fixture.Db.Workspaces.AsNoTracking().ToListAsync());
    }

    private sealed class Fixture : IAsyncDisposable
    {
        private Fixture(
            AppDbContext db,
            CurrentTenantService currentTenant,
            Tenant tenant,
            User actor,
            WorkspaceAuthorizationService authorization)
        {
            Db = db;
            CurrentTenant = currentTenant;
            Tenant = tenant;
            Actor = actor;
            Authorization = authorization;
        }

        public AppDbContext Db { get; }
        public CurrentTenantService CurrentTenant { get; }
        public Tenant Tenant { get; }
        public User Actor { get; }
        public WorkspaceAuthorizationService Authorization { get; }

        public static async Task<Fixture> CreateAsync(
            TenantUserRole role,
            TenantUserStatus membershipStatus,
            UserStatus userStatus,
            SystemRole systemRole = SystemRole.NormalUser,
            TenantStatus tenantStatus = TenantStatus.Active)
        {
            var currentTenant = new CurrentTenantService();
            currentTenant.SetPlatformScope();
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase($"wpc01-{Guid.NewGuid():N}")
                .Options;
            var db = new AppDbContext(options, currentTenant);
            var tenant = new Tenant
            {
                Name = "WPC Tenant",
                DisplayName = "WPC Tenant",
                Slug = $"wpc-{Guid.NewGuid():N}",
                Status = tenantStatus
            };
            var actor = NewUser("owner@example.test", userStatus, systemRole);
            db.Tenants.Add(tenant);
            db.Users.Add(actor);
            db.TenantUsers.Add(new TenantUser
            {
                TenantId = tenant.Id,
                UserId = actor.Id,
                Role = role,
                Status = membershipStatus,
                JoinedAt = DateTimeOffset.UtcNow
            });
            await db.SaveChangesAsync();
            currentTenant.SetTenant(tenant.Id, tenant.Slug);

            var users = new UserRepository(db);
            var workspaces = new WorkspaceRepository(db);
            var tenantAuthorization = new TenantAuthorizationService(new TenantRepository(db));
            return new Fixture(
                db,
                currentTenant,
                tenant,
                actor,
                new WorkspaceAuthorizationService(users, workspaces, tenantAuthorization));
        }

        public async Task<User> AddActorAsync(
            TenantUserRole role,
            TenantUserStatus membershipStatus,
            string email)
        {
            var actor = NewUser(email, UserStatus.Active, SystemRole.NormalUser);
            Db.Users.Add(actor);
            Db.TenantUsers.Add(new TenantUser
            {
                TenantId = Tenant.Id,
                UserId = actor.Id,
                Role = role,
                Status = membershipStatus,
                JoinedAt = DateTimeOffset.UtcNow
            });
            await Db.SaveChangesAsync();
            return actor;
        }

        public async Task<Tenant> AddTenantForActorAsync()
        {
            CurrentTenant.SetPlatformScope();
            var tenant = new Tenant
            {
                Name = "Second WPC Tenant",
                DisplayName = "Second WPC Tenant",
                Slug = $"wpc-second-{Guid.NewGuid():N}",
                Status = TenantStatus.Active
            };
            Db.Tenants.Add(tenant);
            Db.TenantUsers.Add(new TenantUser
            {
                TenantId = tenant.Id,
                UserId = Actor.Id,
                Role = TenantUserRole.Owner,
                Status = TenantUserStatus.Active,
                JoinedAt = DateTimeOffset.UtcNow
            });
            await Db.SaveChangesAsync();
            return tenant;
        }

        public WorkspaceService CreateService(
            User? actor = null,
            IAuthorizationStateChangePublisher? authorizationChanges = null)
        {
            actor ??= Actor;
            var currentUser = new TestCurrentUser(actor.Id);
            var users = new UserRepository(Db);
            var workspaces = new WorkspaceRepository(Db);
            var clock = new TestClock();
            var publisher = authorizationChanges ?? new AuthorizationStateChangePublisher(
                new TransactionalOutbox(new OutboxEventRepository(Db), CurrentTenant, clock),
                CurrentTenant,
                clock);
            return new WorkspaceService(
                workspaces,
                users,
                new WorkspaceAuthorizationService(
                    users,
                    workspaces,
                    new TenantAuthorizationService(new TenantRepository(Db))),
                currentUser,
                clock,
                new DbAuditLogger(Db, clock, currentUser, CurrentTenant),
                new EfUnitOfWork(Db),
                CurrentTenant,
                publisher,
                new EfCreateIdempotencyCoordinator(Db));
        }

        public ValueTask DisposeAsync() => Db.DisposeAsync();

        private static User NewUser(string email, UserStatus status, SystemRole systemRole) => new()
        {
            DisplayName = email,
            Email = email,
            NormalizedEmail = email.ToUpperInvariant(),
            Status = status,
            SystemRole = systemRole
        };
    }

    private sealed class TestCurrentUser(Guid userId) : ICurrentUser
    {
        public Guid? UserId => userId;
        public Guid? SessionId => Guid.NewGuid();
        public string? Email => "wpc@example.test";
        public SystemRole? SystemRole => AipPortal.Domain.Enums.SystemRole.NormalUser;
        public bool IsAuthenticated => true;
    }

    private sealed class TestClock : IClock
    {
        public DateTimeOffset UtcNow => new(2026, 8, 13, 0, 0, 0, TimeSpan.Zero);
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
