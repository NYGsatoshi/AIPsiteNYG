using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Groups;
using AipPortal.Application.Workspaces;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Projects;

public sealed class ProjectAuthorizationService(
    IProjectRepository projects,
    IWorkspaceAuthorizationService workspaces,
    IGroupAuthorizationService groups,
    IGroupRepository groupRepository) : IProjectAuthorizationService, ITaskAuthorizationService, ICommentAuthorizationService
{
    public async Task<bool> CanViewProject(Guid userId, Guid projectId, CancellationToken cancellationToken = default)
    {
        var project = await projects.GetProjectAsync(projectId, cancellationToken);
        if (project is null ||
            project.DeletedAt.HasValue ||
            project.Status is ProjectStatus.Archived or ProjectStatus.Deleted)
        {
            return false;
        }

        // A ProjectMember row must never outlive the actor's current workspace
        // access.  File grants and Task detail open actions rely on this check
        // when reauthorizing a Task/File association.
        if (!await workspaces.CanViewWorkspace(userId, project.WorkspaceId, cancellationToken))
        {
            return false;
        }

        var member = await projects.GetMemberAsync(projectId, userId, cancellationToken);
        if (member is not null) return true;

        if (!project.GroupId.HasValue)
        {
            return await workspaces.CanViewWorkspace(userId, project.WorkspaceId, cancellationToken);
        }

        return await workspaces.CanManageWorkspace(userId, project.WorkspaceId, cancellationToken) ||
            await groupRepository.GetMemberAsync(project.GroupId.Value, userId, cancellationToken) is not null;
    }

    public async Task<bool> CanManageProject(Guid userId, Guid projectId, CancellationToken cancellationToken = default)
    {
        var project = await projects.GetProjectAsync(projectId, cancellationToken);
        if (project is null) return false;
        if (!await workspaces.CanViewWorkspace(userId, project.WorkspaceId, cancellationToken)) return false;
        if (await workspaces.CanManageWorkspace(userId, project.WorkspaceId, cancellationToken)) return true;
        if (project.GroupId.HasValue && await groups.CanManageGroup(userId, project.GroupId.Value, cancellationToken)) return true;
        var member = await projects.GetMemberAsync(projectId, userId, cancellationToken);
        return member?.Role is ProjectRole.Owner or ProjectRole.Manager;
    }

    public async Task<bool> CanCreateProject(Guid userId, Guid workspaceId, Guid groupId, CancellationToken cancellationToken = default)
    {
        if (groupId == Guid.Empty)
        {
            return false;
        }

        var group = await groupRepository.GetByIdAsync(groupId, cancellationToken);
        return group is not null &&
            group.WorkspaceId == workspaceId &&
            await groups.CanManageGroup(userId, groupId, cancellationToken);
    }

    public async Task<bool> CanCreateTask(Guid userId, Guid projectId, CancellationToken cancellationToken = default)
    {
        if (!await CanViewProject(userId, projectId, cancellationToken))
        {
            return false;
        }

        var member = await projects.GetMemberAsync(projectId, userId, cancellationToken);
        return member is not null || await CanManageProject(userId, projectId, cancellationToken);
    }

    public async Task<bool> CanUpdateTask(Guid userId, Guid taskItemId, CancellationToken cancellationToken = default)
    {
        var task = await projects.GetTaskAsync(taskItemId, cancellationToken);
        if (task is null || task.DeletedAt.HasValue || !await CanViewProject(userId, task.ProjectId, cancellationToken)) return false;
        return await CanManageProject(userId, task.ProjectId, cancellationToken) || task.CreatedByUserId == userId || task.PrimaryAssigneeUserId == userId;
    }

    public async Task<bool> CanAssignTask(Guid userId, Guid taskItemId, CancellationToken cancellationToken = default)
    {
        var task = await projects.GetTaskAsync(taskItemId, cancellationToken);
        return task is not null && await CanManageProject(userId, task.ProjectId, cancellationToken);
    }

    public Task<bool> CanDeleteTask(Guid userId, Guid taskItemId, CancellationToken cancellationToken = default) => CanAssignTask(userId, taskItemId, cancellationToken);

    public async Task<bool> CanReviewTask(Guid userId, Guid taskItemId, CancellationToken cancellationToken = default)
    {
        var task = await projects.GetTaskAsync(taskItemId, cancellationToken);
        return task is not null && (task.ReviewerUserId == userId || await CanManageProject(userId, task.ProjectId, cancellationToken));
    }

    public Task<bool> CanOverrideTaskReview(Guid userId, Guid taskItemId, CancellationToken cancellationToken = default) => CanAssignTask(userId, taskItemId, cancellationToken);

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
