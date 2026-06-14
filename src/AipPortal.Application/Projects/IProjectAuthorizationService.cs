using AipPortal.Domain.Enums;

namespace AipPortal.Application.Projects;

public interface IProjectAuthorizationService
{
    Task<bool> CanViewProject(Guid userId, Guid projectId, CancellationToken cancellationToken = default);
    Task<bool> CanManageProject(Guid userId, Guid projectId, CancellationToken cancellationToken = default);
    Task<bool> CanCreateProject(Guid userId, Guid workspaceId, Guid groupId, CancellationToken cancellationToken = default);
}

public interface ITaskAuthorizationService
{
    Task<bool> CanCreateTask(Guid userId, Guid projectId, CancellationToken cancellationToken = default);
    Task<bool> CanUpdateTask(Guid userId, Guid taskItemId, CancellationToken cancellationToken = default);
    Task<bool> CanAssignTask(Guid userId, Guid taskItemId, CancellationToken cancellationToken = default);
}

public interface ICommentAuthorizationService
{
    Task<bool> CanCommentOnTarget(Guid userId, CommentTargetType targetType, Guid targetId, CancellationToken cancellationToken = default);
}
