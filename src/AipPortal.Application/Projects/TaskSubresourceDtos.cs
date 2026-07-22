namespace AipPortal.Application.Projects;

public sealed record TaskChecklistResponse(Guid Id, string Text, bool IsCompleted, DateTimeOffset? CompletedAt, Guid? CompletedByUserId, long SortKey, long Version);
public sealed record CreateTaskChecklistRequest(string Text);
public sealed record UpdateTaskChecklistRequest(string? Text, bool? IsCompleted, long ExpectedVersion);
public sealed record TaskCommentResponse(Guid Id, Guid TaskId, TaskPersonSummary? Author, string? BodyPlainText, bool IsImportant, DateTimeOffset CreatedAt, DateTimeOffset? UpdatedAt, DateTimeOffset? DeletedAt, long Version, bool CanEdit, bool CanDelete);
public sealed record TaskCommentPage(IReadOnlyList<TaskCommentResponse> Items, int Page, int PageSize, int TotalCount);
public sealed record CreateTaskCommentRequest(string BodyPlainText, bool IsImportant = false);
public sealed record UpdateTaskCommentRequest(string? BodyPlainText, bool? IsImportant, long ExpectedVersion);
public sealed record ProjectTaskLabelResponse(Guid Id, string Name, string? Description, long SortKey, bool IsArchived, long Version);
public sealed record CreateProjectTaskLabelRequest(string Name, string? Description, long? SortKey = null);
public sealed record UpdateProjectTaskLabelRequest(string? Name, string? Description, long? SortKey, long ExpectedVersion);
public sealed record TaskSubresourceSummary(int ChecklistCompletedCount, int ChecklistTotalCount, int CommentCount, int LabelCount, int SubtaskCount);
public sealed record TaskSubtaskResponse(Guid Id, Guid ParentTaskId, string Title, string? Description, string Priority, long Version);
public sealed record CreateTaskSubtaskRequest(string Title, string? Description, AipPortal.Domain.Enums.TaskPriority Priority = AipPortal.Domain.Enums.TaskPriority.Medium);
public sealed record TaskFileAssociationResponse(Guid Id, Guid FileObjectId, string FileName, string ContentType, long SizeBytes, string ScanStatus, DateTimeOffset CreatedAt);
public sealed record CreateTaskFileAssociationRequest(Guid AttachmentId, long ExpectedVersion);
