namespace AipPortal.Application.Workspaces;

public interface IWorkspaceAuthorizationService
{
    Task<bool> CanViewWorkspace(Guid userId, Guid workspaceId, CancellationToken cancellationToken = default);

    Task<bool> CanContributeWorkspace(Guid userId, Guid workspaceId, CancellationToken cancellationToken = default);

    Task<bool> CanManageWorkspace(Guid userId, Guid workspaceId, CancellationToken cancellationToken = default);

    Task<bool> CanCreateWorkspace(Guid userId, Guid tenantId, CancellationToken cancellationToken = default);
}
