using AipPortal.Application.Auth;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Security;

namespace AipPortal.Tests.Auth;

public sealed class AuthServiceTests
{
    [Fact]
    public void PasswordHashingVerifiesCorrectPassword()
    {
        var hasher = new Pbkdf2PasswordHasher();
        var hash = hasher.HashPassword("CorrectHorse123");

        Assert.True(hasher.VerifyPassword(hash, "CorrectHorse123"));
        Assert.False(hasher.VerifyPassword(hash, "wrong-password"));
        Assert.DoesNotContain("CorrectHorse123", hash, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ExpiredInviteCannotBeUsed()
    {
        var fixture = AuthFixture.Create();
        fixture.AddInvite("invite-token", "student@example.com", expiresAt: fixture.Clock.UtcNow.AddMinutes(-1));

        var result = await fixture.Service.RegisterByInviteAsync(new RegisterByInviteRequest(
            "invite-token",
            "Student",
            "student@example.com",
            "Password123"));

        Assert.False(result.IsSuccess);
        Assert.DoesNotContain(fixture.Users.Values, user => user.Email == "student@example.com");
    }

    [Fact]
    public async Task AcceptedInviteCannotBeReused()
    {
        var fixture = AuthFixture.Create();
        fixture.AddInvite(
            "invite-token",
            "student@example.com",
            expiresAt: fixture.Clock.UtcNow.AddDays(1),
            acceptedAt: fixture.Clock.UtcNow);

        var result = await fixture.Service.RegisterByInviteAsync(new RegisterByInviteRequest(
            "invite-token",
            "Student",
            "student@example.com",
            "Password123"));

        Assert.False(result.IsSuccess);
        Assert.DoesNotContain(fixture.Users.Values, user => user.Email == "student@example.com");
    }

    [Fact]
    public async Task RevokedInviteCannotBeUsed()
    {
        var fixture = AuthFixture.Create();
        fixture.AddInvite(
            "invite-token",
            "student@example.com",
            expiresAt: fixture.Clock.UtcNow.AddDays(1),
            revokedAt: fixture.Clock.UtcNow);

        var result = await fixture.Service.RegisterByInviteAsync(new RegisterByInviteRequest(
            "invite-token",
            "Student",
            "student@example.com",
            "Password123"));

        Assert.False(result.IsSuccess);
        Assert.DoesNotContain(fixture.Users.Values, user => user.Email == "student@example.com");
    }

    [Fact]
    public async Task SuspendedUserCannotLogin()
    {
        var fixture = AuthFixture.Create();
        fixture.AddUser("student@example.com", "Password123", UserStatus.Suspended);

        var result = await fixture.Service.LoginAsync(new LoginRequest("student@example.com", "Password123"));

        Assert.False(result.IsSuccess);
        Assert.Equal("Invalid email or password.", result.Error);
        Assert.Empty(fixture.Sessions);
    }

    private sealed class AuthFixture
    {
        private AuthFixture()
        {
            Service = new AuthService(
                new FakeUserRepository(Users),
                new FakeInviteRepository(Invites),
                new FakeSessionRepository(Sessions),
                PasswordHasher,
                TokenHasher,
                new FakeAuditLogger(),
                new FakeCurrentUser(),
                Clock,
                new FakeUnitOfWork());
        }

        public Dictionary<Guid, User> Users { get; } = [];
        public Dictionary<string, Invite> Invites { get; } = [];
        public List<Session> Sessions { get; } = [];
        public FakeClock Clock { get; } = new(new DateTimeOffset(2026, 6, 6, 0, 0, 0, TimeSpan.Zero));
        public Pbkdf2PasswordHasher PasswordHasher { get; } = new();
        public Sha256TokenHasher TokenHasher { get; } = new();
        public AuthService Service { get; }

        public static AuthFixture Create() => new();

        public void AddUser(string email, string password, UserStatus status)
        {
            var user = new User
            {
                DisplayName = "Student",
                Email = email,
                NormalizedEmail = email.ToUpperInvariant(),
                PasswordHash = PasswordHasher.HashPassword(password),
                SystemRole = SystemRole.User,
                Status = status
            };

            Users[user.Id] = user;
        }

        public void AddInvite(
            string token,
            string email,
            DateTimeOffset expiresAt,
            DateTimeOffset? acceptedAt = null,
            DateTimeOffset? revokedAt = null)
        {
            var invite = new Invite
            {
                WorkspaceId = Guid.NewGuid(),
                Email = email,
                NormalizedEmail = email.ToUpperInvariant(),
                TokenHash = TokenHasher.HashToken(token),
                Role = WorkspaceRole.Member,
                ExpiresAt = expiresAt,
                AcceptedAt = acceptedAt,
                RevokedAt = revokedAt,
                InvitedByUserId = Guid.NewGuid()
            };

            Invites[invite.TokenHash] = invite;
        }
    }

    private sealed class FakeUserRepository(Dictionary<Guid, User> users) : IUserRepository
    {
        public Task<User?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
        {
            users.TryGetValue(id, out var user);
            return Task.FromResult(user);
        }

        public Task<User?> GetByNormalizedEmailAsync(string normalizedEmail, CancellationToken cancellationToken = default)
        {
            return Task.FromResult(users.Values.FirstOrDefault(user => user.NormalizedEmail == normalizedEmail));
        }

        public Task AddAsync(User user, CancellationToken cancellationToken = default)
        {
            users[user.Id] = user;
            return Task.CompletedTask;
        }
    }

    private sealed class FakeInviteRepository(Dictionary<string, Invite> invites) : IInviteRepository
    {
        public Task<Invite?> GetByTokenHashAsync(string tokenHash, CancellationToken cancellationToken = default)
        {
            invites.TryGetValue(tokenHash, out var invite);
            return Task.FromResult(invite);
        }
    }

    private sealed class FakeSessionRepository(List<Session> sessions) : ISessionRepository
    {
        public Task AddAsync(Session session, CancellationToken cancellationToken = default)
        {
            sessions.Add(session);
            return Task.CompletedTask;
        }

        public Task RevokeAsync(Guid sessionId, DateTimeOffset revokedAt, CancellationToken cancellationToken = default)
        {
            var session = sessions.FirstOrDefault(item => item.Id == sessionId);
            if (session is not null)
            {
                session.RevokedAt = revokedAt;
            }

            return Task.CompletedTask;
        }
    }

    private sealed class FakeAuditLogger : IAuditLogger
    {
        public Task LogAsync(AuditLogEntry entry, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private sealed class FakeCurrentUser : ICurrentUser
    {
        public Guid? UserId => null;
        public Guid? SessionId => null;
        public string? Email => null;
        public SystemRole? SystemRole => null;
        public bool IsAuthenticated => false;
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
