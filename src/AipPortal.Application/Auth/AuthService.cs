using System.Net.Mail;
using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Auth;

public sealed class AuthService(
    IUserRepository users,
    IInviteRepository invites,
    ITenantRepository tenants,
    IWorkspaceRepository workspaces,
    ISessionRepository sessions,
    IUserSessionService userSessions,
    IPasswordHasher passwordHasher,
    ITokenHasher tokenHasher,
    IAuditLogger auditLogger,
    ICurrentUser currentUser,
    IClock clock,
    IUnitOfWork unitOfWork,
    AuthSecurityOptions securityOptions) : IAuthService
{
    private const int MinimumPasswordLength = 8;
    private const string GenericLoginError = "Invalid email or password.";
    private static readonly TimeSpan SessionLifetime = TimeSpan.FromHours(8);

    public async Task<Result<LoginResponse>> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default)
    {
        if (!IsValidEmail(request.Email) || string.IsNullOrWhiteSpace(request.Password))
        {
            await auditLogger.LogSecurityAsync("LoginFailure", "Invalid login attempt.", LoginSecurityMetadata(null, request.Email), SecurityEventSeverity.Warning, cancellationToken);
            await LogAndSaveAsync(null, "LoginFailure", "User", null, "Invalid login attempt.", cancellationToken);
            return Result<LoginResponse>.Failure(GenericLoginError);
        }

        var normalizedEmail = NormalizeEmail(request.Email);
        var user = await users.GetByNormalizedEmailAsync(normalizedEmail, cancellationToken);

        if (user is not null && CanUserLogin(user))
        {
            NormalizeExpiredLockout(user);
            if (IsLockedOut(user))
            {
                await auditLogger.LogSecurityAsync(
                    "LoginLockout",
                    "Login attempt rejected because the account is locked.",
                    LoginSecurityMetadata(user, request.Email),
                    SecurityEventSeverity.Warning,
                    cancellationToken);
                await LogAndSaveAsync(user.Id, "LoginLockout", "User", user.Id, "Login attempt rejected because the account is locked.", cancellationToken);
                return Result<LoginResponse>.Failure(GenericLoginError);
            }
        }

        if (user is null || !CanUserLogin(user))
        {
            await auditLogger.LogSecurityAsync("LoginFailure", "Invalid login attempt.", LoginSecurityMetadata(user, request.Email), SecurityEventSeverity.Warning, cancellationToken);
            await LogAndSaveAsync(user?.Id, "LoginFailure", "User", user?.Id, "Invalid login attempt.", cancellationToken);
            return Result<LoginResponse>.Failure(GenericLoginError);
        }

        if (!passwordHasher.VerifyPassword(user.PasswordHash, request.Password))
        {
            ApplyFailedLogin(user);
            await auditLogger.LogSecurityAsync("LoginFailure", "Invalid login attempt.", LoginSecurityMetadata(user, request.Email), SecurityEventSeverity.Warning, cancellationToken);
            if (IsLockedOut(user))
            {
                await auditLogger.LogSecurityAsync(
                    "LoginLockout",
                    "Account locked after repeated failed login attempts.",
                    LoginSecurityMetadata(user, request.Email),
                    SecurityEventSeverity.Warning,
                    cancellationToken);
                await auditLogger.LogAsync(new AuditLogEntry(user.Id, "LoginLockout", "User", user.Id, "Account locked after repeated failed login attempts."), cancellationToken);
            }

            await LogAndSaveAsync(user.Id, "LoginFailure", "User", user.Id, "Invalid login attempt.", cancellationToken);
            return Result<LoginResponse>.Failure(GenericLoginError);
        }

        ResetFailedLoginState(user);
        user.LastLoginAt = clock.UtcNow;
        var session = CreateSession(user.Id);
        await sessions.AddAsync(session, cancellationToken);
        await auditLogger.LogAsync(new AuditLogEntry(user.Id, "LoginSuccess", "User", user.Id, "User logged in."), cancellationToken);
        await auditLogger.LogSecurityAsync("LoginSuccess", "User logged in.", LoginSecurityMetadata(user, request.Email), cancellationToken: cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);

        return Result<LoginResponse>.Success(await ToLoginResponseAsync(user, session, cancellationToken));
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

        var normalizedEmail = NormalizeEmail(request.Email);
        var inviteResult = await GetUsableInviteAsync(request.InviteToken, cancellationToken);
        if (!inviteResult.IsSuccess || inviteResult.Value is null)
        {
            return Result<LoginResponse>.Failure(inviteResult.Error ?? "Invite is invalid or expired.");
        }

        if (inviteResult.Value.NormalizedEmail != normalizedEmail)
        {
            return Result<LoginResponse>.Failure("Invite is invalid or expired.");
        }

        return await AcceptInviteCoreAsync(inviteResult.Value, request.DisplayName, request.Password, cancellationToken);
    }

    public async Task<Result<InviteValidationResponse>> ValidateInviteAsync(string token, CancellationToken cancellationToken = default)
    {
        var inviteResult = await GetUsableInviteAsync(token, cancellationToken);
        if (!inviteResult.IsSuccess || inviteResult.Value is null)
        {
            return Result<InviteValidationResponse>.Failure(inviteResult.Error ?? "Invite is invalid.");
        }

        var tenant = await tenants.GetTenantAsync(inviteResult.Value.TenantId, cancellationToken);
        var tenantName = !string.IsNullOrWhiteSpace(tenant?.DisplayName)
            ? tenant.DisplayName
            : !string.IsNullOrWhiteSpace(tenant?.Name)
                ? tenant.Name
                : "AIP Portal";
        var workspace = await workspaces.GetByIdAsync(inviteResult.Value.WorkspaceId, cancellationToken);
        var workspaceName = !string.IsNullOrWhiteSpace(workspace?.Name)
            ? workspace.Name
            : "Default Workspace";

        return Result<InviteValidationResponse>.Success(new InviteValidationResponse(
            true,
            inviteResult.Value.Email,
            inviteResult.Value.Role.ToString(),
            tenantName,
            workspaceName,
            inviteResult.Value.ExpiresAt));
    }

    public async Task<Result<LoginResponse>> AcceptInviteAsync(AcceptInviteRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.DisplayName))
        {
            return Result<LoginResponse>.Failure("Display name is required.");
        }

        if (!IsValidPassword(request.Password))
        {
            return Result<LoginResponse>.Failure($"Password must be at least {MinimumPasswordLength} characters.");
        }

        var inviteResult = await GetUsableInviteAsync(request.Token, cancellationToken);
        if (!inviteResult.IsSuccess || inviteResult.Value is null)
        {
            return Result<LoginResponse>.Failure(inviteResult.Error ?? "Invite is invalid or expired.");
        }

        return await AcceptInviteCoreAsync(inviteResult.Value, request.DisplayName, request.Password, cancellationToken);
    }

    private async Task<Result<LoginResponse>> AcceptInviteCoreAsync(
        Invite invite,
        string displayName,
        string password,
        CancellationToken cancellationToken)
    {
        var existingUser = await users.GetByNormalizedEmailAsync(invite.NormalizedEmail, cancellationToken);
        User user;
        if (existingUser is null)
        {
            user = new User
            {
                DisplayName = displayName.Trim(),
                Email = invite.Email.Trim(),
                NormalizedEmail = invite.NormalizedEmail,
                PasswordHash = passwordHasher.HashPassword(password),
                SystemRole = SystemRole.User,
                Status = UserStatus.Active
            };
            await users.AddAsync(user, cancellationToken);
        }
        else
        {
            if (!CanUserLogin(existingUser))
            {
                return Result<LoginResponse>.Failure("Invite cannot be accepted for this account.");
            }

            user = existingUser;
        }

        var now = clock.UtcNow;
        await EnsureTenantMembershipAsync(invite, user.Id, now, cancellationToken);
        await EnsureWorkspaceMembershipAsync(invite, user.Id, now, cancellationToken);
        invite.AcceptedAt = clock.UtcNow;

        var session = CreateSession(user.Id);
        await sessions.AddAsync(session, cancellationToken);
        await auditLogger.LogAsync(new AuditLogEntry(user.Id, "InviteAccepted", "Invite", invite.Id, "Invite accepted."), cancellationToken);
        await auditLogger.LogSecurityAsync("InviteAccepted", "Invite accepted.", new Dictionary<string, object?> { ["userId"] = user.Id, ["inviteId"] = invite.Id }, cancellationToken: cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);

        return Result<LoginResponse>.Success(await ToLoginResponseAsync(user, session, cancellationToken));
    }

    private async Task<Result<Invite>> GetUsableInviteAsync(string token, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return Result<Invite>.Failure("Invite token is required.");
        }

        var tokenHash = tokenHasher.HashToken(token);
        var invite = await invites.GetByTokenHashAsync(tokenHash, cancellationToken);
        if (invite is null)
        {
            return Result<Invite>.Failure("Invite is invalid.");
        }

        if (invite.AcceptedAt.HasValue)
        {
            return Result<Invite>.Failure("Invite has already been used.");
        }

        if (invite.RevokedAt.HasValue)
        {
            return Result<Invite>.Failure("Invite was revoked.");
        }

        if (invite.ExpiresAt <= clock.UtcNow)
        {
            return Result<Invite>.Failure("Invite has expired.");
        }

        return Result<Invite>.Success(invite);
    }

    private async Task EnsureTenantMembershipAsync(Invite invite, Guid userId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var membership = await tenants.GetTenantUserAsync(invite.TenantId, userId, cancellationToken);
        if (membership is null)
        {
            await tenants.AddTenantUserAsync(new TenantUser
            {
                TenantId = invite.TenantId,
                UserId = userId,
                Role = ToTenantUserRole(invite.Role),
                Status = TenantUserStatus.Active,
                JoinedAt = now,
                InvitedByUserId = invite.InvitedByUserId
            }, cancellationToken);
            return;
        }

        membership.Role = ToTenantUserRole(invite.Role);
        membership.Status = TenantUserStatus.Active;
        if (membership.JoinedAt == default)
        {
            membership.JoinedAt = now;
        }

        membership.InvitedByUserId ??= invite.InvitedByUserId;
    }

    private async Task EnsureWorkspaceMembershipAsync(Invite invite, Guid userId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var membership = await workspaces.GetMemberAsync(invite.WorkspaceId, userId, cancellationToken);
        if (membership is null)
        {
            await workspaces.AddMemberAsync(new WorkspaceMember
            {
                TenantId = invite.TenantId,
                WorkspaceId = invite.WorkspaceId,
                UserId = userId,
                Role = invite.Role,
                Status = MembershipStatus.Active,
                JoinedAt = now
            }, cancellationToken);
            return;
        }

        membership.Role = invite.Role;
        membership.Status = MembershipStatus.Active;
        membership.JoinedAt ??= now;
    }

    private static TenantUserRole ToTenantUserRole(WorkspaceRole role)
    {
        return role is WorkspaceRole.Owner or WorkspaceRole.Admin
            ? TenantUserRole.Admin
            : TenantUserRole.Member;
    }

    public async Task<Result> LogoutAsync(CancellationToken cancellationToken = default)
    {
        if (!currentUser.IsAuthenticated)
        {
            return Result.Success();
        }

        if (currentUser.SessionId.HasValue)
        {
            await userSessions.RevokeSessionAsync(currentUser.SessionId.Value, currentUser.UserId, "Logout", cancellationToken);
        }

        await auditLogger.LogAsync(new AuditLogEntry(currentUser.UserId, "Logout", "User", currentUser.UserId, "User logged out."), cancellationToken);
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
        await auditLogger.LogAsync(new AuditLogEntry(user.Id, "PasswordChanged", "User", user.Id, "Password changed."), cancellationToken);
        await auditLogger.LogSecurityAsync("PasswordChanged", "Password changed.", new Dictionary<string, object?> { ["userId"] = user.Id }, cancellationToken: cancellationToken);
        await userSessions.RevokeUserSessionsAsync(user.Id, user.Id, "PasswordChanged", currentUser.SessionId, cancellationToken);
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
        if (user is null || user.DeletedAt.HasValue || user.Status != UserStatus.Active)
        {
            return Result<CurrentUserResponse>.Failure("Authentication is required.");
        }

        var workspaceContext = await BuildWorkspaceContextAsync(user, cancellationToken);

        return Result<CurrentUserResponse>.Success(new CurrentUserResponse(
            user.Id,
            user.DisplayName,
            user.Email,
            user.SystemRole,
            user.Status,
            BuildCapabilities(user.SystemRole),
            workspaceContext.CurrentWorkspace,
            workspaceContext.Workspaces));
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

    private async Task<LoginResponse> ToLoginResponseAsync(User user, Session session, CancellationToken cancellationToken)
    {
        var workspaceContext = await BuildWorkspaceContextAsync(user, cancellationToken);

        return new LoginResponse(
            user.Id,
            session.Id,
            user.DisplayName,
            user.Email,
            user.SystemRole,
            session.ExpiresAt,
            BuildCapabilities(user.SystemRole),
            workspaceContext.CurrentWorkspace,
            workspaceContext.Workspaces);
    }

    private async Task<WorkspaceContext> BuildWorkspaceContextAsync(User user, CancellationToken cancellationToken)
    {
        var includeAll = user.SystemRole == SystemRole.SystemAdmin;
        var userWorkspaces = await workspaces.ListForUserAsync(user.Id, includeAll, cancellationToken);
        var activeWorkspaces = userWorkspaces
            .Where(workspace => !workspace.DeletedAt.HasValue && workspace.Status is not WorkspaceStatus.Archived and not WorkspaceStatus.Deleted)
            .OrderBy(workspace => workspace.CreatedAt)
            .Select(workspace => new AuthWorkspaceSummary(workspace.Id, workspace.Name, workspace.Description, workspace.Status))
            .ToList();

        return new WorkspaceContext(activeWorkspaces.FirstOrDefault(), activeWorkspaces);
    }

    private sealed record WorkspaceContext(
        AuthWorkspaceSummary? CurrentWorkspace,
        IReadOnlyList<AuthWorkspaceSummary> Workspaces);

    private static IReadOnlyList<string> BuildCapabilities(SystemRole role)
    {
        var capabilities = new List<string>
        {
            "workspace:view",
            "announcements:view",
            "projects:view",
            "files:view",
            "account:view"
        };

        if (role is SystemRole.Admin or SystemRole.PlatformAdmin or SystemRole.SystemAdmin)
        {
            capabilities.Add("audit:view");
        }

        if (role is SystemRole.PlatformAdmin or SystemRole.SystemAdmin)
        {
            capabilities.Add("admin:access");
            capabilities.Add("invite:read");
            capabilities.Add("invite:create");
        }

        return capabilities;
    }

    private bool IsLockedOut(User user)
    {
        return securityOptions.LoginLockoutEnabled &&
               user.LockoutEndAt.HasValue &&
               user.LockoutEndAt.Value > clock.UtcNow;
    }

    private static bool CanUserLogin(User user)
    {
        return !user.DeletedAt.HasValue && user.Status == UserStatus.Active;
    }

    private void NormalizeExpiredLockout(User user)
    {
        if (user.LockoutEndAt.HasValue && user.LockoutEndAt.Value <= clock.UtcNow)
        {
            user.LockoutEndAt = null;
            user.FailedLoginAttempts = 0;
        }
    }

    private void ApplyFailedLogin(User user)
    {
        if (!securityOptions.LoginLockoutEnabled)
        {
            return;
        }

        var maxAttempts = Math.Max(1, securityOptions.MaxFailedLoginAttempts);
        var durationMinutes = Math.Max(1, securityOptions.LoginLockoutDurationMinutes);
        user.FailedLoginAttempts++;
        if (user.FailedLoginAttempts >= maxAttempts)
        {
            user.LockoutEndAt = clock.UtcNow.AddMinutes(durationMinutes);
        }
    }

    private static void ResetFailedLoginState(User user)
    {
        user.FailedLoginAttempts = 0;
        user.LockoutEndAt = null;
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

    private static IReadOnlyDictionary<string, object?> LoginSecurityMetadata(User? user, string? submittedEmail)
    {
        return new Dictionary<string, object?>
        {
            ["emailProvided"] = !string.IsNullOrWhiteSpace(submittedEmail),
            ["userId"] = user?.Id
        };
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
