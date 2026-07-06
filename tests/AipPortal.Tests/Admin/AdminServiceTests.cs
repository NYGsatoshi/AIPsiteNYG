using AipPortal.Application.Admin;
using AipPortal.Application.Auth;
using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Security;

namespace AipPortal.Tests.Admin;

public sealed class AdminServiceTests
{
    [Fact]
    public async Task NormalUserCannotAccessAdminUsers()
    {
        var fixture = AdminFixture.Create(SystemRole.User);

        var result = await fixture.Service.ListUsersAsync(1, 50);

        Assert.False(result.IsSuccess);
        Assert.Equal("SystemAdmin access is required.", result.Error);
    }

    [Fact]
    public async Task NormalUserCannotCreateInvite()
    {
        var fixture = AdminFixture.Create(SystemRole.User);

        var result = await fixture.Service.CreateInviteAsync(new CreateInviteRequest(
            Guid.NewGuid(),
            "new-user@example.com",
            WorkspaceRole.Member,
            null));

        Assert.False(result.IsSuccess);
        Assert.Equal("SystemAdmin access is required.", result.Error);
        Assert.Empty(fixture.Repository.Invites);
    }

    [Fact]
    public async Task CreateInviteReturnsRawTokenOnceAndStoresOnlyHash()
    {
        var fixture = AdminFixture.Create(SystemRole.SystemAdmin);

        var result = await fixture.Service.CreateInviteAsync(new CreateInviteRequest(
            Guid.NewGuid(),
            "new-user@example.com",
            WorkspaceRole.Member,
            null));

        Assert.True(result.IsSuccess);
        Assert.False(string.IsNullOrWhiteSpace(result.Value?.InviteToken));
        var storedInvite = Assert.Single(fixture.Repository.Invites);
        Assert.NotEqual(result.Value!.InviteToken, storedInvite.TokenHash);
        Assert.Equal(new Sha256TokenHasher().HashToken(result.Value.InviteToken!), storedInvite.TokenHash);
        Assert.Equal(fixture.Clock.UtcNow.AddDays(7), storedInvite.ExpiresAt);
    }

    [Fact]
    public async Task LastSystemAdminDemotionIsPrevented()
    {
        var fixture = AdminFixture.Create(SystemRole.SystemAdmin);

        var result = await fixture.Service.ChangeSystemRoleAsync(
            fixture.ActorUser.Id,
            new ChangeSystemRoleRequest(SystemRole.User));

        Assert.False(result.IsSuccess);
        Assert.Equal(SystemRole.SystemAdmin, fixture.ActorUser.SystemRole);
    }

    [Fact]
    public async Task SensitiveSettingValueIsNotReturned()
    {
        var fixture = AdminFixture.Create(SystemRole.SystemAdmin);

        var updated = await fixture.Service.UpdateSettingAsync(
            "IntegrationSecret",
            new UpdateSystemSettingRequest("secret-value", "String", "External integration secret.", true));
        var fetched = await fixture.Service.GetSettingAsync("IntegrationSecret");

        Assert.True(updated.IsSuccess);
        Assert.True(fetched.IsSuccess);
        Assert.Equal("********", updated.Value?.Value);
        Assert.Equal("********", fetched.Value?.Value);
        Assert.Equal("secret-value", fixture.Repository.Settings.Single().Value);
    }

    private sealed class AdminFixture
    {
        private AdminFixture(SystemRole actorRole)
        {
            ActorUser = new User
            {
                DisplayName = "Actor",
                Email = "actor@example.com",
                NormalizedEmail = "ACTOR@EXAMPLE.COM",
                SystemRole = actorRole,
                Status = UserStatus.Active
            };

            Repository.Users[ActorUser.Id] = ActorUser;
            Service = new AdminService(
                Repository,
                new Sha256TokenHasher(),
                new FakeAuditLogger(),
                new FakeCurrentUser(ActorUser),
                Clock,
                new FakeUserSessionService(),
                new FakeUnitOfWork());
        }

        public FakeAdminRepository Repository { get; } = new();
        public FakeClock Clock { get; } = new(new DateTimeOffset(2026, 6, 7, 0, 0, 0, TimeSpan.Zero));
        public User ActorUser { get; }
        public AdminService Service { get; }

        public static AdminFixture Create(SystemRole actorRole) => new(actorRole);
    }

    private sealed class FakeAdminRepository : IAdminRepository
    {
        public Dictionary<Guid, User> Users { get; } = [];
        public List<SystemSetting> Settings { get; } = [];
        public List<Invite> Invites { get; } = [];

        public Task<PagedResponse<AdminUserListItemResponse>> ListUsersAsync(int page, int pageSize, CancellationToken cancellationToken = default)
        {
            var items = Users.Values
                .Select(user => new AdminUserListItemResponse(user.Id, user.DisplayName, user.Email, user.SystemRole, user.Status, user.LastLoginAt, user.CreatedAt, user.UpdatedAt, user.DeletedAt))
                .ToList();
            return Task.FromResult(new PagedResponse<AdminUserListItemResponse>(items, page, pageSize, items.Count));
        }

        public Task<User?> GetUserAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            Users.TryGetValue(userId, out var user);
            return Task.FromResult(user);
        }

        public Task<User?> GetUserByNormalizedEmailAsync(string normalizedEmail, CancellationToken cancellationToken = default)
        {
            return Task.FromResult(Users.Values.FirstOrDefault(user => user.NormalizedEmail == normalizedEmail));
        }

        public Task<int> CountSystemAdminsAsync(CancellationToken cancellationToken = default)
        {
            return Task.FromResult(Users.Values.Count(user => user.SystemRole == SystemRole.SystemAdmin && user.Status == UserStatus.Active && !user.DeletedAt.HasValue));
        }

        public Task<int> CountSystemAdminsExcludingAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            return Task.FromResult(Users.Values.Count(user => user.Id != userId && user.SystemRole == SystemRole.SystemAdmin && user.Status == UserStatus.Active && !user.DeletedAt.HasValue));
        }

        public Task<PagedResponse<AdminInviteResponse>> ListInvitesAsync(int page, int pageSize, CancellationToken cancellationToken = default)
        {
            var items = Invites.Select(invite => new AdminInviteResponse(invite.Id, invite.WorkspaceId, invite.Email, invite.Role, invite.ExpiresAt, invite.AcceptedAt, invite.RevokedAt, invite.InvitedByUserId, invite.CreatedAt)).ToList();
            return Task.FromResult(new PagedResponse<AdminInviteResponse>(items, page, pageSize, items.Count));
        }

        public Task AddInviteAsync(Invite invite, CancellationToken cancellationToken = default)
        {
            Invites.Add(invite);
            return Task.CompletedTask;
        }

        public Task<Invite?> GetInviteAsync(Guid inviteId, CancellationToken cancellationToken = default)
        {
            return Task.FromResult(Invites.FirstOrDefault(invite => invite.Id == inviteId));
        }

        public Task<Workspace?> GetWorkspaceAsync(Guid workspaceId, CancellationToken cancellationToken = default) => Task.FromResult<Workspace?>(new Workspace { CreatedByUserId = Guid.NewGuid() });

        public Task<Group?> GetGroupAsync(Guid groupId, CancellationToken cancellationToken = default) => Task.FromResult<Group?>(null);

        public Task<Project?> GetProjectAsync(Guid projectId, CancellationToken cancellationToken = default) => Task.FromResult<Project?>(null);

        public Task<Channel?> GetChannelAsync(Guid channelId, CancellationToken cancellationToken = default) => Task.FromResult<Channel?>(null);

        public Task<IReadOnlyList<SystemSetting>> ListSettingsAsync(CancellationToken cancellationToken = default)
        {
            return Task.FromResult<IReadOnlyList<SystemSetting>>(Settings);
        }

        public Task<SystemSetting?> GetSettingAsync(string key, CancellationToken cancellationToken = default)
        {
            return Task.FromResult(Settings.FirstOrDefault(setting => setting.Key == key));
        }

        public Task AddSettingAsync(SystemSetting setting, CancellationToken cancellationToken = default)
        {
            Settings.Add(setting);
            return Task.CompletedTask;
        }

        public Task<AdminDashboardSnapshot> GetDashboardSnapshotAsync(int recentCount, DateOnly today, CancellationToken cancellationToken = default)
        {
            return Task.FromResult(new AdminDashboardSnapshot(0, 0, 0, 0, 0, 0, 0, 0, [], []));
        }
    }

    private sealed class FakeAuditLogger : IAuditLogger
    {
        public Task LogAsync(AuditLogEntry entry, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private sealed class FakeUserSessionService : IUserSessionService
    {
        public Task<SessionValidationResult> ValidateSessionAsync(Guid userId, Guid sessionId, Guid? tenantId, bool requireActiveTenantMembership, CancellationToken cancellationToken = default)
        {
            return Task.FromResult(SessionValidationResult.Success());
        }

        public Task<Result> RevokeSessionAsync(Guid sessionId, Guid? actorUserId, string reason, CancellationToken cancellationToken = default)
        {
            return Task.FromResult(Result.Success());
        }

        public Task<Result<int>> RevokeUserSessionsAsync(Guid userId, Guid? actorUserId, string reason, Guid? exceptSessionId = null, CancellationToken cancellationToken = default)
        {
            return Task.FromResult(Result<int>.Success(0));
        }
    }

    private sealed class FakeCurrentUser(User user) : ICurrentUser
    {
        public Guid? UserId => user.Id;
        public Guid? SessionId => Guid.NewGuid();
        public string? Email => user.Email;
        public SystemRole? SystemRole => user.SystemRole;
        public bool IsAuthenticated => true;
    }

    private sealed class FakeClock(DateTimeOffset utcNow) : IClock
    {
        public DateTimeOffset UtcNow { get; } = utcNow;
    }

    private sealed class FakeUnitOfWork : IUnitOfWork
    {
        public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            return Task.FromResult(1);
        }
    }
}
