using AipPortal.Application.Common;

namespace AipPortal.Application.Projects;

public interface ITaskSubresourceService
{
    Task<Result<IReadOnlyList<TaskSubtaskResponse>>> ListSubtasksAsync(Guid taskId, CancellationToken cancellationToken = default);
    Task<Result<TaskSubtaskResponse>> CreateSubtaskAsync(Guid taskId, CreateTaskSubtaskRequest request, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<TaskFileAssociationResponse>>> ListFilesAsync(Guid taskId, CancellationToken cancellationToken = default);
    Task<Result<TaskFileAssociationResponse>> AssociateFileAsync(Guid taskId, CreateTaskFileAssociationRequest request, CancellationToken cancellationToken = default);
    Task<Result> RemoveFileAsync(Guid taskId, Guid associationId, long expectedVersion, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<TaskChecklistResponse>>> ListChecklistAsync(Guid taskId, CancellationToken cancellationToken = default);
    Task<Result<TaskChecklistResponse>> CreateChecklistAsync(Guid taskId, CreateTaskChecklistRequest request, CancellationToken cancellationToken = default);
    Task<Result<TaskChecklistResponse>> UpdateChecklistAsync(Guid taskId, Guid itemId, UpdateTaskChecklistRequest request, CancellationToken cancellationToken = default);
    Task<Result> DeleteChecklistAsync(Guid taskId, Guid itemId, long expectedVersion, CancellationToken cancellationToken = default);
    Task<Result<TaskCommentPage>> ListCommentsAsync(Guid taskId, int page, int pageSize, CancellationToken cancellationToken = default);
    Task<Result<TaskCommentResponse>> CreateCommentAsync(Guid taskId, CreateTaskCommentRequest request, CancellationToken cancellationToken = default);
    Task<Result<TaskCommentResponse>> UpdateCommentAsync(Guid commentId, UpdateTaskCommentRequest request, CancellationToken cancellationToken = default);
    Task<Result> DeleteCommentAsync(Guid commentId, long expectedVersion, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<ProjectTaskLabelResponse>>> ListLabelsAsync(Guid projectId, bool includeArchived, CancellationToken cancellationToken = default);
    Task<Result<ProjectTaskLabelResponse>> CreateLabelAsync(Guid projectId, CreateProjectTaskLabelRequest request, CancellationToken cancellationToken = default);
    Task<Result<ProjectTaskLabelResponse>> UpdateLabelAsync(Guid projectId, Guid labelId, UpdateProjectTaskLabelRequest request, CancellationToken cancellationToken = default);
    Task<Result<ProjectTaskLabelResponse>> SetLabelArchiveAsync(Guid projectId, Guid labelId, long expectedVersion, bool archived, CancellationToken cancellationToken = default);
    Task<Result> ApplyLabelAsync(Guid taskId, Guid labelId, CancellationToken cancellationToken = default);
    Task<Result> RemoveLabelAsync(Guid taskId, Guid labelId, CancellationToken cancellationToken = default);
    Task<TaskSubresourceSummary> GetSummaryAsync(Guid taskId, CancellationToken cancellationToken = default);
}
