using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Tenancy;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Workspaces;

public sealed class WorkspaceAuthorizationService(
    IUserRepository users,
    IWorkspaceRepository workspaces,
    ITenantAuthorizationService? tenants = null) : IWorkspaceAuthorizationService
{
    public async Task<bool> CanViewWorkspace(Guid userId, Guid workspaceId, CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessAsync(userId, workspaceId, cancellationToken);
        var workspace = access.Workspace;
        var member = access.Member;
        if (workspace is null || workspace.DeletedAt.HasValue || workspace.Status == WorkspaceStatus.Deleted)
        {
            return false;
        }

        if (workspace.Status == WorkspaceStatus.Archived)
        {
            // Archived Workspaces are an authorized historical projection.
            // A platform role alone never grants archived access.
            return member is { Status: MembershipStatus.Active };
        }

        if (workspace.Status != WorkspaceStatus.Active)
        {
            return false;
        }

        if (await IsSystemAdmin(userId, cancellationToken))
        {
            return true;
        }

        return member is { Status: MembershipStatus.Active };
    }

    public async Task<bool> CanManageWorkspace(Guid userId, Guid workspaceId, CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessAsync(userId, workspaceId, cancellationToken);
        var workspace = access.Workspace;
        if (workspace is null ||
            workspace.DeletedAt.HasValue ||
            workspace.Status != WorkspaceStatus.Active)
        {
            return false;
        }

        if (await IsSystemAdmin(userId, cancellationToken))
        {
            return true;
        }

        return access.Member is { Status: MembershipStatus.Active } member && member.Role.CanManage();
    }

    public async Task<bool> CanGovernWorkspace(Guid userId, Guid workspaceId, CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessAsync(userId, workspaceId, cancellationToken);
        var workspace = access.Workspace;
        var member = access.Member;
        if (workspace is null || workspace.DeletedAt.HasValue || workspace.Status == WorkspaceStatus.Deleted)
        {
            return false;
        }

        if (workspace.Status == WorkspaceStatus.Archived)
        {
            return member is { Status: MembershipStatus.Active } && member.Role.CanManage();
        }

        if (workspace.Status != WorkspaceStatus.Active)
        {
            return false;
        }

        return await IsSystemAdmin(userId, cancellationToken) ||
               member is { Status: MembershipStatus.Active } && member.Role.CanManage();
    }

    public async Task<bool> CanRestoreWorkspace(Guid userId, Guid workspaceId, CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessAsync(userId, workspaceId, cancellationToken);
        var workspace = access.Workspace;
        if (workspace is null ||
            workspace.DeletedAt.HasValue ||
            workspace.Status != WorkspaceStatus.Archived)
        {
            return false;
        }

        return access.Member is
        {
            Status: MembershipStatus.Active,
            Role: WorkspaceRole.Owner
        };
    }

    public async Task<bool> CanContributeWorkspace(Guid userId, Guid workspaceId, CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessAsync(userId, workspaceId, cancellationToken);
        var workspace = access.Workspace;
        if (workspace is null ||
            workspace.DeletedAt.HasValue ||
            workspace.Status != WorkspaceStatus.Active)
        {
            return false;
        }

        if (await IsSystemAdmin(userId, cancellationToken))
        {
            return true;
        }

        return access.Member is { Status: MembershipStatus.Active } member && member.Role.CanContribute();
    }

    public async Task<bool> CanCreateWorkspace(Guid userId, Guid tenantId, CancellationToken cancellationToken = default)
    {
        var user = await users.GetByIdAsync(userId, cancellationToken);
        return tenantId != Guid.Empty &&
               tenants is not null &&
               user is { Status: UserStatus.Active, DeletedAt: null } &&
               await tenants.CanManageTenantAsync(userId, tenantId, cancellationToken);
    }

    private async Task<WorkspaceAccess> ResolveAccessAsync(
        Guid userId,
        Guid workspaceId,
        CancellationToken cancellationToken)
    {
        // Membership is the common authorization read. WorkspaceRepository
        // hydrates the parent in the same SQL command, so current Workspace
        // status is checked without issuing a second round trip for members.
        // Non-members still resolve the Workspace explicitly so SystemAdmin
        // handling and unknown/deleted Workspace behavior remain fail-closed.
        var member = await workspaces.GetMemberAsync(workspaceId, userId, cancellationToken);
        var workspace = member?.Workspace ?? await workspaces.GetByIdAsync(workspaceId, cancellationToken);
        return new WorkspaceAccess(workspace, member);
    }

    private async Task<bool> IsSystemAdmin(Guid userId, CancellationToken cancellationToken)
    {
        var user = await users.GetByIdAsync(userId, cancellationToken);
        return user is { SystemRole: SystemRole.SystemAdmin, Status: UserStatus.Active, DeletedAt: null };
    }

    private sealed record WorkspaceAccess(Workspace? Workspace, WorkspaceMember? Member);
}
