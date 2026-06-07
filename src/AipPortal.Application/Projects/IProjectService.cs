using AipPortal.Application.Common;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Projects;

public interface IProjectService
{
    Task<Result<IReadOnlyList<ProjectResponse>>> ListAsync(bool archived = false, CancellationToken cancellationToken = default);
    Task<Result<ProjectResponse>> CreateAsync(CreateProjectRequest request, CancellationToken cancellationToken = default);
    Task<Result<ProjectResponse>> GetAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<Result<ProjectResponse>> UpdateAsync(Guid projectId, UpdateProjectRequest request, CancellationToken cancellationToken = default);
    Task<Result> ArchiveAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<Result> RestoreAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<ProjectMemberResponse>>> ListMembersAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<Result<ProjectMemberResponse>> AddMemberAsync(Guid projectId, AddProjectMemberRequest request, CancellationToken cancellationToken = default);
    Task<Result<ProjectMemberResponse>> UpdateMemberAsync(Guid projectId, Guid userId, UpdateProjectMemberRequest request, CancellationToken cancellationToken = default);
    Task<Result> RemoveMemberAsync(Guid projectId, Guid userId, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<MilestoneResponse>>> ListMilestonesAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<Result<MilestoneResponse>> CreateMilestoneAsync(Guid projectId, CreateMilestoneRequest request, CancellationToken cancellationToken = default);
    Task<Result<MilestoneResponse>> UpdateMilestoneAsync(Guid milestoneId, UpdateMilestoneRequest request, CancellationToken cancellationToken = default);
    Task<Result> DeleteMilestoneAsync(Guid milestoneId, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<TaskItemResponse>>> ListTasksAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<Result<TaskItemResponse>> CreateTaskAsync(Guid projectId, CreateTaskItemRequest request, CancellationToken cancellationToken = default);
    Task<Result<TaskItemResponse>> GetTaskAsync(Guid taskItemId, CancellationToken cancellationToken = default);
    Task<Result<TaskItemResponse>> UpdateTaskAsync(Guid taskItemId, UpdateTaskItemRequest request, CancellationToken cancellationToken = default);
    Task<Result> DeleteTaskAsync(Guid taskItemId, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<TaskAssignmentResponse>>> ListAssignmentsAsync(Guid taskItemId, CancellationToken cancellationToken = default);
    Task<Result<TaskAssignmentResponse>> AddAssignmentAsync(Guid taskItemId, AddTaskAssignmentRequest request, CancellationToken cancellationToken = default);
    Task<Result<TaskAssignmentResponse>> UpdateAssignmentAsync(Guid assignmentId, UpdateTaskAssignmentRequest request, CancellationToken cancellationToken = default);
    Task<Result> DeleteAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<TaskDependencyResponse>>> ListDependenciesAsync(Guid taskItemId, CancellationToken cancellationToken = default);
    Task<Result<TaskDependencyResponse>> AddDependencyAsync(Guid taskItemId, AddTaskDependencyRequest request, CancellationToken cancellationToken = default);
    Task<Result> DeleteDependencyAsync(Guid dependencyId, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<CommentResponse>>> ListCommentsAsync(CommentTargetType targetType, Guid targetId, CancellationToken cancellationToken = default);
    Task<Result<CommentResponse>> AddCommentAsync(CreateCommentRequest request, CancellationToken cancellationToken = default);
    Task<Result<CommentResponse>> UpdateCommentAsync(Guid commentId, UpdateCommentRequest request, CancellationToken cancellationToken = default);
    Task<Result> DeleteCommentAsync(Guid commentId, CancellationToken cancellationToken = default);
}
