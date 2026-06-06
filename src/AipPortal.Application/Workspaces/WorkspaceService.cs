using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
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
    IUnitOfWork unitOfWork) : IWorkspaceService
{
    public async Task<Result<IReadOnlyList<WorkspaceListItemResponse>>> ListAsync(CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId))
        {
            return Result<IReadOnlyList<WorkspaceListItemResponse>>.Failure("Authentication is required.");
        }

        var user = await users.GetByIdAsync(userId, cancellationToken);
        var includeAll = user?.SystemRole == SystemRole.SystemAdmin;
        var items = await workspaces.ListForUserAsync(userId, includeAll, cancellationToken);
        return Result<IReadOnlyList<WorkspaceListItemResponse>>.Success(items.Select(ToListItem).ToList());
    }

    public async Task<Result<WorkspaceDetailResponse>> CreateAsync(CreateWorkspaceRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId))
        {
            return Result<WorkspaceDetailResponse>.Failure("Authentication is required.");
        }

        if (!await authorization.CanCreateWorkspace(userId, cancellationToken))
        {
            return Result<WorkspaceDetailResponse>.Failure("You are not allowed to create workspaces.");
        }

        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return Result<WorkspaceDetailResponse>.Failure("Workspace name is required.");
        }

        var workspace = new Workspace
        {
            Name = request.Name.Trim(),
            Slug = SlugGenerator.FromName(request.Name),
            Description = request.Description?.Trim(),
            Icon = request.Icon?.Trim(),
            Status = WorkspaceStatus.Active,
            CreatedByUserId = userId
        };

        await workspaces.AddAsync(workspace, cancellationToken);
        await workspaces.AddMemberAsync(new WorkspaceMember
        {
            WorkspaceId = workspace.Id,
            UserId = userId,
            Role = WorkspaceRole.Owner,
            Status = MembershipStatus.Active,
            JoinedAt = clock.UtcNow
        }, cancellationToken);
        await AuditAsync(userId, "WorkspaceCreated", workspace.Id, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);

        return Result<WorkspaceDetailResponse>.Success(ToDetail(workspace));
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
            workspace.Slug = SlugGenerator.FromName(workspace.Name);
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

        workspace.Status = WorkspaceStatus.Archived;
        workspace.MarkDeleted(clock.UtcNow);
        await AuditAsync(userId, "WorkspaceArchived", workspace.Id, cancellationToken);
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
