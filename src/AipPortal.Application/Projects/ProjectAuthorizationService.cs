using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Groups;
using AipPortal.Application.Workspaces;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Projects;

public sealed class ProjectAuthorizationService(
    IProjectRepository projects,
    IWorkspaceAuthorizationService workspaces,
    IGroupAuthorizationService groups) : IProjectAuthorizationService, ITaskAuthorizationService, ICommentAuthorizationService
{
    public async Task<bool> CanViewProject(Guid userId, Guid projectId, CancellationToken cancellationToken = default)
    {
        var member = await projects.GetMemberAsync(projectId, userId, cancellationToken);
        if (member is not null) return true;
        var project = await projects.GetProjectAsync(projectId, cancellationToken);
        if (project is null || project.DeletedAt.HasValue || project.Status == ProjectStatus.Archived)
        {
            return false;
        }

        return project.GroupId.HasValue
            ? await groups.CanViewGroup(userId, project.GroupId.Value, cancellationToken)
            : await workspaces.CanViewWorkspace(userId, project.WorkspaceId, cancellationToken);
    }

    public async Task<bool> CanManageProject(Guid userId, Guid projectId, CancellationToken cancellationToken = default)
    {
        var project = await projects.GetProjectAsync(projectId, cancellationToken);
        if (project is null) return false;
        if (await workspaces.CanManageWorkspace(userId, project.WorkspaceId, cancellationToken)) return true;
        if (project.GroupId.HasValue && await groups.CanManageGroup(userId, project.GroupId.Value, cancellationToken)) return true;
        var member = await projects.GetMemberAsync(projectId, userId, cancellationToken);
        return member?.Role is ProjectRole.Owner or ProjectRole.Manager;
    }

    public async Task<bool> CanCreateProject(Guid userId, Guid workspaceId, Guid? groupId, CancellationToken cancellationToken = default)
    {
        return groupId.HasValue
            ? await groups.CanManageGroup(userId, groupId.Value, cancellationToken)
            : await workspaces.CanManageWorkspace(userId, workspaceId, cancellationToken);
    }

    public Task<bool> CanCreateTask(Guid userId, Guid projectId, CancellationToken cancellationToken = default) => CanManageProject(userId, projectId, cancellationToken);

    public async Task<bool> CanUpdateTask(Guid userId, Guid taskItemId, CancellationToken cancellationToken = default)
    {
        var task = await projects.GetTaskAsync(taskItemId, cancellationToken);
        return task is not null && await CanManageProject(userId, task.ProjectId, cancellationToken);
    }

    public Task<bool> CanAssignTask(Guid userId, Guid taskItemId, CancellationToken cancellationToken = default) => CanUpdateTask(userId, taskItemId, cancellationToken);

    public async Task<bool> CanCommentOnTarget(Guid userId, CommentTargetType targetType, Guid targetId, CancellationToken cancellationToken = default)
    {
        if (targetType == CommentTargetType.Project) return await CanViewProject(userId, targetId, cancellationToken);
        if (targetType == CommentTargetType.TaskItem)
        {
            var task = await projects.GetTaskAsync(targetId, cancellationToken);
            return task is not null && await CanViewProject(userId, task.ProjectId, cancellationToken);
        }
        if (targetType == CommentTargetType.Milestone)
        {
            var milestone = await projects.GetMilestoneAsync(targetId, cancellationToken);
            return milestone is not null && await CanViewProject(userId, milestone.ProjectId, cancellationToken);
        }
        return false;
    }
}
