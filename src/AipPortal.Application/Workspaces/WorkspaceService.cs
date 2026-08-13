using System.Security.Cryptography;
using System.Text;
using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Realtime;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Workspaces;

public sealed class WorkspaceService(
    IWorkspaceRepository workspaces,
    IUserRepository users,
    IWorkspaceAuthorizationService authorization,
    ICurrentUser currentUser,
    IClock clock,
    IAuditLogger auditLogger,
    IUnitOfWork unitOfWork,
    ICurrentTenant? currentTenant = null,
    IAuthorizationStateChangePublisher? authorizationChanges = null,
    ICreateIdempotencyCoordinator? createIdempotency = null) : IWorkspaceService
{
    private const string WorkspaceCreateOperation = "Workspace.Create.v1";

    public async Task<Result<IReadOnlyList<WorkspaceListItemResponse>>> ListAsync(CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId))
        {
            return Result<IReadOnlyList<WorkspaceListItemResponse>>.Failure("Authentication is required.");
        }

        var user = await users.GetByIdAsync(userId, cancellationToken);
        var includeAll = user?.SystemRole == SystemRole.SystemAdmin;
        var items = await workspaces.ListForUserAsync(userId, includeAll, cancellationToken);
        return Result<IReadOnlyList<WorkspaceListItemResponse>>.Success(items
            .Where(workspace => !workspace.DeletedAt.HasValue && workspace.Status != WorkspaceStatus.Archived && workspace.Status != WorkspaceStatus.Deleted)
            .Select(ToListItem)
            .ToList());
    }

    public async Task<Result<WorkspaceCapabilitiesResponse>> GetCapabilitiesAsync(CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId))
        {
            return Result<WorkspaceCapabilitiesResponse>.Failure(new ApplicationErrorDetail(
                "AuthenticationRequired",
                "Authentication is required."));
        }

        if (currentTenant is not { IsAvailable: true, IsPlatformScope: false })
        {
            return Result<WorkspaceCapabilitiesResponse>.Failure(new ApplicationErrorDetail(
                "TenantUnavailable",
                "An active Tenant context is required."));
        }

        var canCreate = await authorization.CanCreateWorkspace(userId, currentTenant.TenantId, cancellationToken);
        return Result<WorkspaceCapabilitiesResponse>.Success(new WorkspaceCapabilitiesResponse(canCreate));
    }

    public async Task<Result<WorkspaceDetailResponse>> CreateAsync(
        CreateWorkspaceRequest request,
        string? clientRequestIdentity,
        CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId))
        {
            return Result<WorkspaceDetailResponse>.Failure(new ApplicationErrorDetail(
                "AuthenticationRequired",
                "Authentication is required."));
        }

        if (currentTenant is not { IsAvailable: true, IsPlatformScope: false })
        {
            return Result<WorkspaceDetailResponse>.Failure(new ApplicationErrorDetail(
                "TenantUnavailable",
                "An active Tenant context is required."));
        }

        if (!await authorization.CanCreateWorkspace(userId, currentTenant.TenantId, cancellationToken))
        {
            return Result<WorkspaceDetailResponse>.Failure(new ApplicationErrorDetail(
                "CapabilityDenied",
                "You are not allowed to create workspaces."));
        }

        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return ValidationFailure("Workspace name is required.");
        }

        var name = request.Name.Trim();
        var description = NormalizeOptional(request.Description);
        var icon = NormalizeOptional(request.Icon);
        if (name.Length > 160)
        {
            return ValidationFailure("Workspace name must not exceed 160 characters.");
        }
        if (description?.Length > 2000)
        {
            return ValidationFailure("Workspace description must not exceed 2000 characters.");
        }
        if (icon?.Length > 120)
        {
            return ValidationFailure("Workspace icon must not exceed 120 characters.");
        }
        if (string.IsNullOrWhiteSpace(clientRequestIdentity) || clientRequestIdentity.Length > 128)
        {
            return ValidationFailure("A valid Idempotency-Key header is required.");
        }
        if (createIdempotency is null)
        {
            return Result<WorkspaceDetailResponse>.Failure(new ApplicationErrorDetail(
                "IdempotencyUnavailable",
                "Workspace creation is temporarily unavailable."));
        }
        if (authorizationChanges is null)
        {
            return Result<WorkspaceDetailResponse>.Failure(new ApplicationErrorDetail(
                "InitializationUnavailable",
                "Workspace creation is temporarily unavailable."));
        }

        var workspace = new Workspace
        {
            Name = name,
            Description = description,
            Icon = icon,
            Status = WorkspaceStatus.Active,
            CreatedByUserId = userId
        };
        workspace.Slug = CreateWorkspaceSlug(name, workspace.Id);

        var idempotency = await createIdempotency.ExecuteAsync(
            new CreateIdempotencyContext(
                currentTenant.TenantId,
                userId,
                WorkspaceCreateOperation,
                clientRequestIdentity,
                CreateRequestFingerprint(name, description, icon),
                "Workspace",
                workspace.Id),
            async token =>
            {
                await workspaces.AddAsync(workspace, token);
                await workspaces.AddMemberAsync(new WorkspaceMember
                {
                    WorkspaceId = workspace.Id,
                    UserId = userId,
                    Role = WorkspaceRole.Owner,
                    Status = MembershipStatus.Active,
                    JoinedAt = clock.UtcNow
                }, token);
                await AuditAsync(userId, "WorkspaceCreated", workspace.Id, token);
                await PublishAuthorizationChangeAsync(userId, workspace.Id, "granted", token);
                return workspace;
            },
            (resourceId, token) => workspaces.GetByIdAsync(resourceId, token),
            cancellationToken);

        return idempotency.Disposition switch
        {
            IdempotentCreateDisposition.Created or IdempotentCreateDisposition.Replayed when idempotency.Value is not null =>
                Result<WorkspaceDetailResponse>.Success(ToDetail(idempotency.Value)),
            IdempotentCreateDisposition.RequestMismatch =>
                Result<WorkspaceDetailResponse>.Failure(new ApplicationErrorDetail(
                    "IdempotencyConflict",
                    "The Idempotency-Key was already used with a different Workspace request.")),
            _ => Result<WorkspaceDetailResponse>.Failure(new ApplicationErrorDetail(
                "IdempotencyReplayUnavailable",
                "The prior Workspace creation result can no longer be reconciled safely."))
        };
    }

    public async Task<Result<WorkspaceDetailResponse>> GetAsync(Guid workspaceId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) || !await authorization.CanViewWorkspace(userId, workspaceId, cancellationToken))
        {
            return Result<WorkspaceDetailResponse>.Failure("Workspace not found.");
        }

        var workspace = await workspaces.GetByIdAsync(workspaceId, cancellationToken);
        return workspace is null
            ? Result<WorkspaceDetailResponse>.Failure("Workspace not found.")
            : Result<WorkspaceDetailResponse>.Success(ToDetail(workspace));
    }

    public async Task<Result<WorkspaceDetailResponse>> UpdateAsync(Guid workspaceId, UpdateWorkspaceRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) || !await authorization.CanManageWorkspace(userId, workspaceId, cancellationToken))
        {
            return Result<WorkspaceDetailResponse>.Failure("You are not allowed to manage this workspace.");
        }

        var workspace = await workspaces.GetByIdAsync(workspaceId, cancellationToken);
        if (workspace is null)
        {
            return Result<WorkspaceDetailResponse>.Failure("Workspace not found.");
        }

        if (request.Name is not null)
        {
            if (string.IsNullOrWhiteSpace(request.Name))
            {
                return Result<WorkspaceDetailResponse>.Failure("Workspace name is required.");
            }

            workspace.Name = request.Name.Trim();
            workspace.Slug = CreateWorkspaceSlug(workspace.Name, workspace.Id);
        }

        workspace.Description = request.Description?.Trim() ?? workspace.Description;
        workspace.Icon = request.Icon?.Trim() ?? workspace.Icon;
        workspace.Status = request.Status ?? workspace.Status;
        await AuditAsync(userId, "WorkspaceUpdated", workspace.Id, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);

        return Result<WorkspaceDetailResponse>.Success(ToDetail(workspace));
    }

    public async Task<Result> ArchiveAsync(Guid workspaceId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) || !await authorization.CanManageWorkspace(userId, workspaceId, cancellationToken))
        {
            return Result.Failure("You are not allowed to manage this workspace.");
        }

        var workspace = await workspaces.GetByIdAsync(workspaceId, cancellationToken);
        if (workspace is null)
        {
            return Result.Failure("Workspace not found.");
        }

        // Determine the affected recipients before changing the lifecycle and
        // stage metadata-only invalidations in this same business unit of
        // work.  The Outbox row is therefore absent on rollback.
        var affectedMembers = (await workspaces.ListMembersAsync(workspaceId, cancellationToken))
            .Where(member => member.Status == MembershipStatus.Active)
            .Select(member => member.UserId)
            .Distinct()
            .ToArray();
        workspace.Status = WorkspaceStatus.Archived;
        await AuditAsync(userId, "WorkspaceArchived", workspace.Id, cancellationToken);
        foreach (var affectedUserId in affectedMembers)
        {
            await PublishAuthorizationChangeAsync(affectedUserId, workspace.Id, "archived", cancellationToken);
        }
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> RestoreAsync(Guid workspaceId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) || !await authorization.CanManageWorkspace(userId, workspaceId, cancellationToken))
        {
            return Result.Failure("You are not allowed to manage this workspace.");
        }

        var workspace = await workspaces.GetByIdAsync(workspaceId, cancellationToken);
        if (workspace is null)
        {
            return Result.Failure("Workspace not found.");
        }

        workspace.Restore();
        if (workspace.Status is WorkspaceStatus.Archived or WorkspaceStatus.Deleted)
        {
            workspace.Status = WorkspaceStatus.Active;
        }

        await AuditAsync(userId, "WorkspaceRestored", workspace.Id, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result<IReadOnlyList<WorkspaceMemberResponse>>> ListMembersAsync(Guid workspaceId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) || !await authorization.CanViewWorkspace(userId, workspaceId, cancellationToken))
        {
            return Result<IReadOnlyList<WorkspaceMemberResponse>>.Failure("Workspace not found.");
        }

        var members = await workspaces.ListMembersAsync(workspaceId, cancellationToken);
        return Result<IReadOnlyList<WorkspaceMemberResponse>>.Success(members.Select(ToMember).ToList());
    }

    public async Task<Result<WorkspaceMemberResponse>> AddMemberAsync(Guid workspaceId, AddWorkspaceMemberRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var actorUserId) || !await authorization.CanManageWorkspace(actorUserId, workspaceId, cancellationToken))
        {
            return Result<WorkspaceMemberResponse>.Failure("You are not allowed to manage members.");
        }

        var user = await users.GetByIdAsync(request.UserId, cancellationToken);
        if (user is null)
        {
            return Result<WorkspaceMemberResponse>.Failure("User not found.");
        }

        if (await workspaces.GetMemberAsync(workspaceId, request.UserId, cancellationToken) is not null)
        {
            return Result<WorkspaceMemberResponse>.Failure("User is already a workspace member.");
        }

        var member = new WorkspaceMember
        {
            WorkspaceId = workspaceId,
            UserId = request.UserId,
            User = user,
            Role = request.Role,
            Status = MembershipStatus.Active,
            JoinedAt = clock.UtcNow
        };

        await workspaces.AddMemberAsync(member, cancellationToken);
        await AuditAsync(actorUserId, "WorkspaceMemberAdded", workspaceId, cancellationToken);
        await PublishAuthorizationChangeAsync(member.UserId, workspaceId, "granted", cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<WorkspaceMemberResponse>.Success(ToMember(member));
    }

    public async Task<Result<WorkspaceMemberResponse>> UpdateMemberAsync(Guid workspaceId, Guid userId, UpdateWorkspaceMemberRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var actorUserId) || !await authorization.CanManageWorkspace(actorUserId, workspaceId, cancellationToken))
        {
            return Result<WorkspaceMemberResponse>.Failure("You are not allowed to manage members.");
        }

        var member = await workspaces.GetMemberAsync(workspaceId, userId, cancellationToken);
        if (member is null)
        {
            return Result<WorkspaceMemberResponse>.Failure("Workspace member not found.");
        }

        member.Role = request.Role;
        member.Status = request.Status ?? member.Status;
        await AuditAsync(actorUserId, "WorkspaceMemberRoleChanged", workspaceId, cancellationToken);
        await PublishAuthorizationChangeAsync(member.UserId, workspaceId, member.Status == MembershipStatus.Active ? "membershipChanged" : "suspended", cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<WorkspaceMemberResponse>.Success(ToMember(member));
    }

    public async Task<Result> RemoveMemberAsync(Guid workspaceId, Guid userId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var actorUserId) || !await authorization.CanManageWorkspace(actorUserId, workspaceId, cancellationToken))
        {
            return Result.Failure("You are not allowed to manage members.");
        }

        var member = await workspaces.GetMemberAsync(workspaceId, userId, cancellationToken);
        if (member is null)
        {
            return Result.Failure("Workspace member not found.");
        }

        member.Status = MembershipStatus.Suspended;
        await AuditAsync(actorUserId, "WorkspaceMemberRemoved", workspaceId, cancellationToken);
        await PublishAuthorizationChangeAsync(userId, workspaceId, "revoked", cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    private bool TryCurrentUser(out Guid userId)
    {
        userId = currentUser.UserId ?? Guid.Empty;
        return currentUser.IsAuthenticated && currentUser.UserId.HasValue;
    }

    private Task AuditAsync(Guid actorUserId, string action, Guid targetId, CancellationToken cancellationToken)
    {
        return auditLogger.LogAsync(new AuditLogEntry(actorUserId, action, "Workspace", targetId), cancellationToken);
    }

    private Task PublishAuthorizationChangeAsync(Guid userId, Guid workspaceId, string change, CancellationToken cancellationToken)
    {
        if (currentTenant is null || !currentTenant.IsAvailable || authorizationChanges is null)
        {
            return Task.CompletedTask;
        }

        return authorizationChanges.PublishAsync(
            currentTenant.TenantId,
            userId,
            "workspace",
            workspaceId,
            change,
            cancellationToken) ?? Task.CompletedTask;
    }

    private static Result<WorkspaceDetailResponse> ValidationFailure(string message) =>
        Result<WorkspaceDetailResponse>.Failure(new ApplicationErrorDetail("ValidationFailed", message));

    private static string? NormalizeOptional(string? value)
    {
        var normalized = value?.Trim();
        return string.IsNullOrEmpty(normalized) ? null : normalized;
    }

    private static string CreateRequestFingerprint(string name, string? description, string? icon)
    {
        var canonical = string.Concat(
            EncodeFingerprintPart(name),
            EncodeFingerprintPart(description),
            EncodeFingerprintPart(icon));
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
    }

    private static string EncodeFingerprintPart(string? value) =>
        value is null ? "-1:" : $"{Encoding.UTF8.GetByteCount(value)}:{value}";

    private static string CreateWorkspaceSlug(string name, Guid workspaceId)
    {
        const int maximumLength = 120;
        var suffix = $"-{workspaceId:N}";
        var stemBuilder = new StringBuilder();
        foreach (var character in name.Trim().ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(character))
            {
                stemBuilder.Append(character);
            }
            else if (stemBuilder.Length > 0 && stemBuilder[^1] != '-')
            {
                stemBuilder.Append('-');
            }
        }

        var stem = stemBuilder.ToString().Trim('-');
        if (string.IsNullOrEmpty(stem))
        {
            stem = "workspace";
        }

        var maximumStemLength = maximumLength - suffix.Length;
        if (stem.Length > maximumStemLength)
        {
            stem = stem[..maximumStemLength].TrimEnd('-');
        }

        return string.Concat(stem, suffix);
    }

    private static WorkspaceListItemResponse ToListItem(Workspace workspace)
    {
        return new WorkspaceListItemResponse(workspace.Id, workspace.Name, workspace.Description, workspace.Icon, workspace.Status, workspace.CreatedAt, workspace.UpdatedAt);
    }

    private static WorkspaceDetailResponse ToDetail(Workspace workspace)
    {
        return new WorkspaceDetailResponse(workspace.Id, workspace.Name, workspace.Description, workspace.Icon, workspace.Status, workspace.CreatedByUserId, workspace.CreatedAt, workspace.UpdatedAt);
    }

    private static WorkspaceMemberResponse ToMember(WorkspaceMember member)
    {
        return new WorkspaceMemberResponse(member.UserId, member.User?.DisplayName ?? string.Empty, member.User?.Email ?? string.Empty, member.Role, member.Status, member.JoinedAt);
    }
}
