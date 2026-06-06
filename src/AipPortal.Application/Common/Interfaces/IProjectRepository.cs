using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Common.Interfaces;

public interface IProjectRepository
{
    Task<IReadOnlyList<Project>> ListVisibleAsync(Guid userId, CancellationToken cancellationToken = default);
    Task<Project?> GetProjectAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<ProjectMember?> GetMemberAsync(Guid projectId, Guid userId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ProjectMember>> ListMembersAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Milestone>> ListMilestonesAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<Milestone?> GetMilestoneAsync(Guid milestoneId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<TaskItem>> ListTasksAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<TaskItem?> GetTaskAsync(Guid taskItemId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<TaskAssignment>> ListAssignmentsAsync(Guid taskItemId, CancellationToken cancellationToken = default);
    Task<TaskAssignment?> GetAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<TaskDependency>> ListDependenciesAsync(Guid taskItemId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<TaskDependency>> ListProjectDependenciesAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<TaskDependency?> GetDependencyAsync(Guid dependencyId, CancellationToken cancellationToken = default);
    Task<bool> DependencyExistsAsync(Guid predecessorTaskId, Guid successorTaskId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Comment>> ListCommentsAsync(CommentTargetType targetType, Guid targetId, CancellationToken cancellationToken = default);
    Task<Comment?> GetCommentAsync(Guid commentId, CancellationToken cancellationToken = default);
    Task AddProjectAsync(Project project, CancellationToken cancellationToken = default);
    Task AddMemberAsync(ProjectMember member, CancellationToken cancellationToken = default);
    Task AddMilestoneAsync(Milestone milestone, CancellationToken cancellationToken = default);
    Task AddTaskAsync(TaskItem task, CancellationToken cancellationToken = default);
    Task AddAssignmentAsync(TaskAssignment assignment, CancellationToken cancellationToken = default);
    Task AddDependencyAsync(TaskDependency dependency, CancellationToken cancellationToken = default);
    Task AddCommentAsync(Comment comment, CancellationToken cancellationToken = default);
    void RemoveMember(ProjectMember member);
    void RemoveAssignment(TaskAssignment assignment);
    void RemoveDependency(TaskDependency dependency);
}
