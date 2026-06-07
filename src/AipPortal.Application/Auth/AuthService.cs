using System.Net.Mail;
using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Auth;

public sealed class AuthService(
    IUserRepository users,
    IInviteRepository invites,
    ISessionRepository sessions,
    IPasswordHasher passwordHasher,
    ITokenHasher tokenHasher,
    IAuditLogger auditLogger,
    ICurrentUser currentUser,
    IClock clock,
    IUnitOfWork unitOfWork) : IAuthService
{
    private const int MinimumPasswordLength = 8;
    private const string GenericLoginError = "Invalid email or password.";
    private static readonly TimeSpan SessionLifetime = TimeSpan.FromHours(8);

    public async Task<Result<LoginResponse>> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default)
    {
        if (!IsValidEmail(request.Email) || string.IsNullOrWhiteSpace(request.Password))
        {
            await auditLogger.LogSecurityAsync("LoginFailure", "Invalid login attempt.", new Dictionary<string, object?> { ["email"] = request.Email }, SecurityEventSeverity.Warning, cancellationToken);
            await LogAndSaveAsync(null, "LoginFailure", "User", null, "Invalid login attempt.", cancellationToken);
            return Result<LoginResponse>.Failure(GenericLoginError);
        }

        var normalizedEmail = NormalizeEmail(request.Email);
        var user = await users.GetByNormalizedEmailAsync(normalizedEmail, cancellationToken);

        if (user is null ||
            user.DeletedAt.HasValue ||
            user.Status != UserStatus.Active ||
            !passwordHasher.VerifyPassword(user.PasswordHash, request.Password))
        {
            await auditLogger.LogSecurityAsync("LoginFailure", "Invalid login attempt.", new Dictionary<string, object?> { ["email"] = request.Email, ["userId"] = user?.Id }, SecurityEventSeverity.Warning, cancellationToken);
            await LogAndSaveAsync(user?.Id, "LoginFailure", "User", user?.Id, "Invalid login attempt.", cancellationToken);
            return Result<LoginResponse>.Failure(GenericLoginError);
        }

        user.LastLoginAt = clock.UtcNow;
        var session = CreateSession(user.Id);
        await sessions.AddAsync(session, cancellationToken);
        await auditLogger.LogAsync(new AuditLogEntry(user.Id, "LoginSuccess", "User", user.Id), cancellationToken);
        await auditLogger.LogSecurityAsync("LoginSuccess", "User logged in.", new Dictionary<string, object?> { ["userId"] = user.Id, ["email"] = user.Email }, cancellationToken: cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);

        return Result<LoginResponse>.Success(ToLoginResponse(user, session));
    }

    public async Task<Result<LoginResponse>> RegisterByInviteAsync(RegisterByInviteRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.DisplayName))
        {
            return Result<LoginResponse>.Failure("Display name is required.");
        }

        if (!IsValidEmail(request.Email))
        {
            return Result<LoginResponse>.Failure("A valid email address is required.");
        }

        if (!IsValidPassword(request.Password))
        {
            return Result<LoginResponse>.Failure($"Password must be at least {MinimumPasswordLength} characters.");
        }

        if (string.IsNullOrWhiteSpace(request.InviteToken))
        {
            return Result<LoginResponse>.Failure("Invite token is required.");
        }

        var tokenHash = tokenHasher.HashToken(request.InviteToken);
        var invite = await invites.GetByTokenHashAsync(tokenHash, cancellationToken);
        var normalizedEmail = NormalizeEmail(request.Email);

        if (invite is null ||
            invite.NormalizedEmail != normalizedEmail ||
            invite.AcceptedAt.HasValue ||
            invite.RevokedAt.HasValue ||
            invite.ExpiresAt <= clock.UtcNow)
        {
            return Result<LoginResponse>.Failure("Invite is invalid or expired.");
        }

        var existingUser = await users.GetByNormalizedEmailAsync(normalizedEmail, cancellationToken);
        if (existingUser is not null)
        {
            return Result<LoginResponse>.Failure("A user with this email already exists.");
        }

        var user = new User
        {
            DisplayName = request.DisplayName.Trim(),
            Email = request.Email.Trim(),
            NormalizedEmail = normalizedEmail,
            PasswordHash = passwordHasher.HashPassword(request.Password),
            SystemRole = SystemRole.User,
            Status = UserStatus.Active
        };

        invite.AcceptedAt = clock.UtcNow;

        await users.AddAsync(user, cancellationToken);
        var session = CreateSession(user.Id);
        await sessions.AddAsync(session, cancellationToken);
        await auditLogger.LogAsync(new AuditLogEntry(user.Id, "InviteAccepted", "Invite", invite.Id), cancellationToken);
        await auditLogger.LogSecurityAsync("InviteAccepted", "Invite accepted.", new Dictionary<string, object?> { ["userId"] = user.Id, ["inviteId"] = invite.Id }, cancellationToken: cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);

        return Result<LoginResponse>.Success(ToLoginResponse(user, session));
    }

    public async Task<Result> LogoutAsync(CancellationToken cancellationToken = default)
    {
        if (!currentUser.IsAuthenticated)
        {
            return Result.Success();
        }

        if (currentUser.SessionId.HasValue)
        {
            await sessions.RevokeAsync(currentUser.SessionId.Value, clock.UtcNow, cancellationToken);
        }

        await auditLogger.LogAsync(new AuditLogEntry(currentUser.UserId, "Logout", "User", currentUser.UserId), cancellationToken);
        await auditLogger.LogSecurityAsync("Logout", "User logged out.", cancellationToken: cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);

        return Result.Success();
    }

    public async Task<Result> ChangePasswordAsync(ChangePasswordRequest request, CancellationToken cancellationToken = default)
    {
        if (!currentUser.UserId.HasValue)
        {
            return Result.Failure("Authentication is required.");
        }

        if (!IsValidPassword(request.NewPassword))
        {
            return Result.Failure($"Password must be at least {MinimumPasswordLength} characters.");
        }

        var user = await users.GetByIdAsync(currentUser.UserId.Value, cancellationToken);
        if (user is null || user.DeletedAt.HasValue || user.Status != UserStatus.Active)
        {
            return Result.Failure("Authentication is required.");
        }

        if (!passwordHasher.VerifyPassword(user.PasswordHash, request.CurrentPassword))
        {
            return Result.Failure("Current password is incorrect.");
        }

        user.PasswordHash = passwordHasher.HashPassword(request.NewPassword);
        await auditLogger.LogAsync(new AuditLogEntry(user.Id, "PasswordChanged", "User", user.Id), cancellationToken);
        await auditLogger.LogSecurityAsync("PasswordChanged", "Password changed.", new Dictionary<string, object?> { ["userId"] = user.Id }, cancellationToken: cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);

        return Result.Success();
    }

    public async Task<Result<CurrentUserResponse>> GetCurrentUserAsync(CancellationToken cancellationToken = default)
    {
        if (!currentUser.UserId.HasValue)
        {
            return Result<CurrentUserResponse>.Failure("Authentication is required.");
        }

        var user = await users.GetByIdAsync(currentUser.UserId.Value, cancellationToken);
        if (user is null || user.DeletedAt.HasValue)
        {
            return Result<CurrentUserResponse>.Failure("Authentication is required.");
        }

        return Result<CurrentUserResponse>.Success(new CurrentUserResponse(
            user.Id,
            user.DisplayName,
            user.Email,
            user.SystemRole,
            user.Status));
    }

    private Session CreateSession(Guid userId)
    {
        return new Session
        {
            UserId = userId,
            SessionKeyHash = tokenHasher.HashToken(Guid.NewGuid().ToString("N")),
            ExpiresAt = clock.UtcNow.Add(SessionLifetime),
            LastSeenAt = clock.UtcNow
        };
    }

    private static LoginResponse ToLoginResponse(User user, Session session)
    {
        return new LoginResponse(
            user.Id,
            session.Id,
            user.DisplayName,
            user.Email,
            user.SystemRole,
            session.ExpiresAt);
    }

    private async Task LogAndSaveAsync(
        Guid? actorUserId,
        string action,
        string targetType,
        Guid? targetId,
        string? summary,
        CancellationToken cancellationToken)
    {
        await auditLogger.LogAsync(new AuditLogEntry(actorUserId, action, targetType, targetId, summary), cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
    }

    private static bool IsValidPassword(string password)
    {
        return !string.IsNullOrWhiteSpace(password) && password.Length >= MinimumPasswordLength;
    }

    private static bool IsValidEmail(string email)
    {
        if (string.IsNullOrWhiteSpace(email))
        {
            return false;
        }

        try
        {
            var parsed = new MailAddress(email.Trim());
            return string.Equals(parsed.Address, email.Trim(), StringComparison.OrdinalIgnoreCase);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static string NormalizeEmail(string email)
    {
        return email.Trim().ToUpperInvariant();
    }
}
