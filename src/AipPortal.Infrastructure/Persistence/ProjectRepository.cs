using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

public sealed class ProjectRepository(AppDbContext dbContext) : IProjectRepository
{
    public async Task<IReadOnlyList<Project>> ListVisibleAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        return await dbContext.Projects
            .AsNoTracking()
            .Where(project =>
                project.Members.Any(member => member.UserId == userId) ||
                dbContext.WorkspaceMembers.Any(member =>
                    member.WorkspaceId == project.WorkspaceId &&
                    member.UserId == userId &&
                    member.Status == MembershipStatus.Active &&
                    (member.Role == WorkspaceRole.Owner || member.Role == WorkspaceRole.Admin)) ||
                (project.GroupId.HasValue && dbContext.GroupMembers.Any(member =>
                    member.GroupId == project.GroupId.Value &&
                    member.UserId == userId)))
            .OrderBy(project => project.Name)
            .ToListAsync(cancellationToken);
    }

    public Task<Project?> GetProjectAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        return dbContext.Projects.FirstOrDefaultAsync(project => project.Id == projectId, cancellationToken);
    }

    public Task<ProjectMember?> GetMemberAsync(Guid projectId, Guid userId, CancellationToken cancellationToken = default)
    {
        return dbContext.ProjectMembers
            .Include(member => member.User)
            .FirstOrDefaultAsync(member => member.ProjectId == projectId && member.UserId == userId, cancellationToken);
    }

    public async Task<IReadOnlyList<ProjectMember>> ListMembersAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        return await dbContext.ProjectMembers
            .AsNoTracking()
            .Include(member => member.User)
            .Where(member => member.ProjectId == projectId)
            .OrderBy(member => member.User!.DisplayName)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Milestone>> ListMilestonesAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        return await dbContext.Milestones
            .AsNoTracking()
            .Where(milestone => milestone.ProjectId == projectId)
            .OrderBy(milestone => milestone.SortOrder)
            .ThenBy(milestone => milestone.DueDate)
            .ToListAsync(cancellationToken);
    }

    public Task<Milestone?> GetMilestoneAsync(Guid milestoneId, CancellationToken cancellationToken = default)
    {
        return dbContext.Milestones.FirstOrDefaultAsync(milestone => milestone.Id == milestoneId, cancellationToken);
    }

    public async Task<IReadOnlyList<TaskItem>> ListTasksAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        return await dbContext.TaskItems
            .AsNoTracking()
            .Where(task => task.ProjectId == projectId)
            .OrderBy(task => task.SortOrder)
            .ThenBy(task => task.DueDate)
            .ThenBy(task => task.Title)
            .ToListAsync(cancellationToken);
    }

    public Task<TaskItem?> GetTaskAsync(Guid taskItemId, CancellationToken cancellationToken = default)
    {
        return dbContext.TaskItems.FirstOrDefaultAsync(task => task.Id == taskItemId, cancellationToken);
    }

    public async Task<IReadOnlyList<TaskAssignment>> ListAssignmentsAsync(Guid taskItemId, CancellationToken cancellationToken = default)
    {
        return await dbContext.TaskAssignments
            .AsNoTracking()
            .Include(assignment => assignment.User)
            .Where(assignment => assignment.TaskItemId == taskItemId)
            .OrderBy(assignment => assignment.Role)
            .ThenBy(assignment => assignment.User!.DisplayName)
            .ToListAsync(cancellationToken);
    }

    public Task<TaskAssignment?> GetAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken = default)
    {
        return dbContext.TaskAssignments
            .Include(assignment => assignment.User)
            .Include(assignment => assignment.TaskItem)
            .FirstOrDefaultAsync(assignment => assignment.Id == assignmentId, cancellationToken);
    }

    public async Task<IReadOnlyList<TaskDependency>> ListDependenciesAsync(Guid taskItemId, CancellationToken cancellationToken = default)
    {
        return await dbContext.TaskDependencies
            .AsNoTracking()
            .Where(dependency => dependency.SuccessorTaskItemId == taskItemId || dependency.PredecessorTaskItemId == taskItemId)
            .OrderBy(dependency => dependency.CreatedAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<TaskDependency>> ListProjectDependenciesAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        return await dbContext.TaskDependencies
            .AsNoTracking()
            .Where(dependency => dependency.ProjectId == projectId)
            .ToListAsync(cancellationToken);
    }

    public Task<TaskDependency?> GetDependencyAsync(Guid dependencyId, CancellationToken cancellationToken = default)
    {
        return dbContext.TaskDependencies.FirstOrDefaultAsync(dependency => dependency.Id == dependencyId, cancellationToken);
    }

    public Task<bool> DependencyExistsAsync(Guid predecessorTaskId, Guid successorTaskId, CancellationToken cancellationToken = default)
    {
        return dbContext.TaskDependencies.AnyAsync(dependency =>
            dependency.PredecessorTaskItemId == predecessorTaskId &&
            dependency.SuccessorTaskItemId == successorTaskId,
            cancellationToken);
    }

    public async Task<IReadOnlyList<Comment>> ListCommentsAsync(CommentTargetType targetType, Guid targetId, CancellationToken cancellationToken = default)
    {
        return await dbContext.Comments
            .AsNoTracking()
            .Where(comment => comment.TargetType == targetType && comment.TargetId == targetId)
            .OrderBy(comment => comment.CreatedAt)
            .ToListAsync(cancellationToken);
    }

    public Task<Comment?> GetCommentAsync(Guid commentId, CancellationToken cancellationToken = default)
    {
        return dbContext.Comments.FirstOrDefaultAsync(comment => comment.Id == commentId, cancellationToken);
    }

    public async Task AddProjectAsync(Project project, CancellationToken cancellationToken = default)
    {
        await dbContext.Projects.AddAsync(project, cancellationToken);
    }

    public async Task AddMemberAsync(ProjectMember member, CancellationToken cancellationToken = default)
    {
        await dbContext.ProjectMembers.AddAsync(member, cancellationToken);
    }

    public async Task AddMilestoneAsync(Milestone milestone, CancellationToken cancellationToken = default)
    {
        await dbContext.Milestones.AddAsync(milestone, cancellationToken);
    }

    public async Task AddTaskAsync(TaskItem task, CancellationToken cancellationToken = default)
    {
        await dbContext.TaskItems.AddAsync(task, cancellationToken);
    }

    public async Task AddAssignmentAsync(TaskAssignment assignment, CancellationToken cancellationToken = default)
    {
        await dbContext.TaskAssignments.AddAsync(assignment, cancellationToken);
    }

    public async Task AddDependencyAsync(TaskDependency dependency, CancellationToken cancellationToken = default)
    {
        await dbContext.TaskDependencies.AddAsync(dependency, cancellationToken);
    }

    public async Task AddCommentAsync(Comment comment, CancellationToken cancellationToken = default)
    {
        await dbContext.Comments.AddAsync(comment, cancellationToken);
    }

    public void RemoveMember(ProjectMember member)
    {
        dbContext.ProjectMembers.Remove(member);
    }

    public void RemoveAssignment(TaskAssignment assignment)
    {
        dbContext.TaskAssignments.Remove(assignment);
    }

    public void RemoveDependency(TaskDependency dependency)
    {
        dbContext.TaskDependencies.Remove(dependency);
    }
}
