using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Realtime;
using AipPortal.Application.Files;
using AipPortal.Application.Messaging;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using System.Text.RegularExpressions;

namespace AipPortal.Application.Projects;

/// <summary>Canonical Task checklist, comment, and label command boundary.  It deliberately stores only metadata in audit events.</summary>
public sealed class TaskSubresourceService(
    IProjectRepository projects, IUserRepository users, IProjectAuthorizationService projectAuthorization, ITaskAuthorizationService taskAuthorization, ICommentAuthorizationService commentAuthorization, IFileRepository files, IFileAuthorizationService fileAuthorization, ITaskCommandService taskCommands, ICommunicationSafetyGuard safetyGuard,
    ICurrentUser currentUser, IClock clock, IAuditLogger audit, IBusinessInvalidationPublisher invalidations, ITaskCommandUnitOfWork taskUnitOfWork, ITaskWorkspaceTimeZoneResolver timeZones) : ITaskSubresourceService
{
    public async Task<Result<CanonicalTaskDetailResponse>> GetDetailAsync(Guid taskId, CancellationToken ct = default)
    {
        var taskResult = await taskCommands.GetAsync(taskId, ct);
        if (!taskResult.IsSuccess) return Fail<CanonicalTaskDetailResponse>("TASK_NOT_FOUND", "Task not found.");
        var task = await VisibleTaskAsync(taskId, ct);
        if (task is null) return Fail<CanonicalTaskDetailResponse>("TASK_NOT_FOUND", "Task not found.");
        var actor = Actor();
        var canUpdate = await taskAuthorization.CanUpdateTask(actor, taskId, ct);
        var canCreateSubtask = !task.ParentTaskItemId.HasValue && await taskAuthorization.CanCreateTask(actor, task.ProjectId, ct);
        var canComment = await commentAuthorization.CanCommentOnTarget(actor, CommentTargetType.TaskItem, taskId, ct);
        var permissions = new TaskDetailPermissions(canCreateSubtask, canUpdate, canUpdate, canUpdate, canUpdate, canComment, canComment, canUpdate, await projectAuthorization.CanManageProject(actor, task.ProjectId, ct), canUpdate, canUpdate, true);
        var relationships = await taskCommands.GetRelationshipsAsync(taskId, ct);
        var watch = await taskCommands.GetWatchStateAsync(taskId, ct);
        var checklist = await ListChecklistAsync(taskId, ct);
        var labels = (await projects.ListWorkItemLabelsAsync(taskId, ct)).Where(x => x.Label is not null).Select(x => ToLabel(x.Label!)).OrderBy(x => x.SortKey).ThenBy(x => x.Name).ToList();
        var subtasks = await ListSubtasksAsync(taskId, 1, 50, ct);
        var comments = await ListCommentsAsync(taskId, 1, 20, ct);
        var filePage = await ListFilesAsync(taskId, 1, 20, ct);
        if (!relationships.IsSuccess || !watch.IsSuccess || !checklist.IsSuccess || !subtasks.IsSuccess || !comments.IsSuccess || !filePage.IsSuccess)
            return Fail<CanonicalTaskDetailResponse>("TASK_NOT_FOUND", "Task not found.");
        return Result<CanonicalTaskDetailResponse>.Success(new(taskResult.Value!, relationships.Value!, permissions, checklist.Value!, labels, watch.Value!, subtasks.Value!, comments.Value!, filePage.Value!));
    }

    public async Task<Result<TaskFileAssociationPage>> ListFilesAsync(Guid taskId, int page = 1, int pageSize = 20, CancellationToken ct = default)
    {
        var task = await VisibleTaskAsync(taskId, ct); if (task is null) return Fail<TaskFileAssociationPage>("TASK_NOT_FOUND", "Task not found.");
        page = Math.Max(1, page); pageSize = Math.Clamp(pageSize, 1, 100);
        var filePage = await files.ListTaskAttachmentsPageAsync(taskId, page, pageSize, ct);
        var pageItems = filePage.Items;
        var mapped = new List<TaskFileAssociationResponse>(pageItems.Count);
        foreach (var item in pageItems) mapped.Add(await ToFileAsync(item, ct));
        return Result<TaskFileAssociationPage>.Success(new(mapped, page, pageSize, filePage.TotalCount, page * pageSize < filePage.TotalCount));
    }
    public async Task<Result<TaskFileAssociationResponse>> AssociateFileAsync(Guid taskId, CreateTaskFileAssociationRequest request, CancellationToken ct = default)
    {
        var task = await EditableTaskAsync(taskId, ct); if (task is null) return Fail<TaskFileAssociationResponse>("TASK_FILE_ASSOCIATION_FORBIDDEN", "Task operation is not authorized.");
        if (task.VersionNo != request.ExpectedVersion) return Fail<TaskFileAssociationResponse>("TASK_STALE_VERSION", "Task has changed. Refetch and retry.");
        var source = await files.GetAttachmentAsync(request.AttachmentId, ct);
        if (source?.FileObject is null || !await fileAuthorization.CanViewAttachment(Actor(), source, ct) || source.WorkspaceId != task.WorkspaceId || source.FileObject.TenantId != task.TenantId || (source.FileObject.ProjectId.HasValue && source.FileObject.ProjectId != task.ProjectId)) return Fail<TaskFileAssociationResponse>("TASK_FILE_ASSOCIATION_FORBIDDEN", "File is not available for this task.");
        if (source.FileObject.Status == AipPortal.Domain.Enums.FileObjectStatus.Quarantined) return Fail<TaskFileAssociationResponse>("TASK_FILE_QUARANTINED", "File is quarantined.");
        if (source.ScanStatus != AipPortal.Domain.Enums.FileScanStatus.Clean) return Fail<TaskFileAssociationResponse>("TASK_FILE_SCAN_NOT_READY", "File scan is not ready.");
        var duplicate = (await files.ListTaskAttachmentsAsync(taskId, ct)).FirstOrDefault(x => x.FileObjectId == source.FileObjectId); if (duplicate is not null) return Result<TaskFileAssociationResponse>.Success(await ToFileAsync(duplicate, ct));
        var association = new Attachment { FileObjectId = source.FileObjectId, WorkspaceId = task.WorkspaceId, OwnerType = AipPortal.Domain.Enums.AttachmentOwnerType.TaskItem, OwnerId = taskId, OwnerUserId = Actor(), UploadedByUserId = source.UploadedByUserId, FileName = source.FileName, StoredFileName = source.StoredFileName, FilePath = source.FilePath, ContentType = source.ContentType, Extension = source.Extension, SizeBytes = source.SizeBytes, StorageProvider = source.StorageProvider, StorageKey = source.StorageKey, ScanStatus = source.ScanStatus };
        await files.AddAttachmentAsync(association, ct);
        var save = await CommitAsync(task, "TaskFileAssociated", "filesChanged", new Dictionary<string, object?> { ["fileObjectId"] = source.FileObjectId }, ct);
        if (save == TaskCommandSaveResult.UniqueConflict)
        {
            // The unique active-association index is the final authority for two
            // concurrent PUTs.  The losing request is still an idempotent success.
            var existing = (await files.ListTaskAttachmentsAsync(taskId, ct)).FirstOrDefault(x => x.FileObjectId == source.FileObjectId);
            if (existing is not null) return Result<TaskFileAssociationResponse>.Success(await ToFileAsync(existing, ct));
        }
        if (save != TaskCommandSaveResult.Saved) return Fail<TaskFileAssociationResponse>("TASK_STALE_VERSION", "Task has changed. Refetch and retry.");
        return Result<TaskFileAssociationResponse>.Success(await ToFileAsync(association, ct));
    }
    public async Task<Result> RemoveFileAsync(Guid taskId, Guid associationId, long expectedVersion, CancellationToken ct = default)
    { var task = await EditableTaskAsync(taskId, ct); var attachment = await files.GetAttachmentAsync(associationId, ct); if (task is null || attachment is null || attachment.OwnerType != AipPortal.Domain.Enums.AttachmentOwnerType.TaskItem || attachment.OwnerId != taskId) return Fail("TASK_FILE_ASSOCIATION_NOT_FOUND", "Task file association not found."); if (task.VersionNo != expectedVersion) return Fail("TASK_STALE_VERSION", "Task has changed. Refetch and retry."); files.RemoveAttachment(attachment); if (await CommitAsync(task, "TaskFileAssociationRemoved", "filesChanged", new Dictionary<string, object?> { ["fileObjectId"] = attachment.FileObjectId }, ct) != TaskCommandSaveResult.Saved) return Fail("TASK_STALE_VERSION", "Task has changed. Refetch and retry."); return Result.Success(); }
    public async Task<Result<TaskSubtaskPage>> ListSubtasksAsync(Guid taskId, int page = 1, int pageSize = 50, CancellationToken ct = default)
    {
        var task = await VisibleTaskAsync(taskId, ct); if (task is null) return Fail<TaskSubtaskPage>("TASK_NOT_FOUND", "Task not found.");
        page = Math.Max(1, page); pageSize = Math.Clamp(pageSize, 1, 100);
        var subtaskPage = await projects.ListDirectSubtasksPageAsync(task.ProjectId, taskId, page, pageSize, ct);
        var items = new List<TaskSubtaskResponse>(); foreach (var item in subtaskPage.Items) items.Add(await ToSubtaskAsync(item, ct));
        return Result<TaskSubtaskPage>.Success(new(items, page, pageSize, subtaskPage.TotalCount, page * pageSize < subtaskPage.TotalCount));
    }
    public async Task<Result<TaskSubtaskResponse>> CreateSubtaskAsync(Guid taskId, CreateTaskSubtaskRequest request, CancellationToken ct = default)
    {
        var parent = await VisibleTaskAsync(taskId, ct);
        if (parent is null) return Fail<TaskSubtaskResponse>("TASK_NOT_FOUND", "Task not found.");
        if (!await taskAuthorization.CanCreateTask(Actor(), parent.ProjectId, ct)) return Fail<TaskSubtaskResponse>("TASK_FORBIDDEN", "Task operation is not authorized.");
        if (parent.ParentTaskItemId.HasValue) return Fail<TaskSubtaskResponse>("TASK_PARENT_DEPTH_EXCEEDED", "A subtask cannot have children.");
        var title = Text(request.Title, 300); if (title is null) return Fail<TaskSubtaskResponse>("VALIDATION_FAILED", "Subtask title is required.");
        var siblings = (await projects.ListTasksAsync(parent.ProjectId, ct)).Where(x => x.ParentTaskItemId == parent.Id).ToList();
        var subtask = new TaskItem { WorkspaceId = parent.WorkspaceId, ProjectId = parent.ProjectId, ParentTaskItemId = parent.Id, Kind = AipPortal.Domain.Enums.WorkItemKind.Task, Title = title, Description = NullableText(request.Description, 12000), Priority = request.Priority, CreatedByUserId = Actor(), SortKey = siblings.Count == 0 ? 1024 : siblings.Max(x => x.SortKey) + 1024 };
        await projects.AddTaskAsync(subtask, ct);
        await projects.AddWatchStateAsync(TaskWatchStateInitializer.ForCreator(subtask, Actor(), clock.UtcNow), ct);
        if (!await CommitSubtaskCreationAsync(parent, subtask, ct)) return Fail<TaskSubtaskResponse>("TASK_STALE_VERSION", "Task has changed. Refetch and retry.");
        return Result<TaskSubtaskResponse>.Success(await ToSubtaskAsync(subtask, ct));
    }
    public async Task<Result<IReadOnlyList<TaskChecklistResponse>>> ListChecklistAsync(Guid taskId, CancellationToken ct = default)
    {
        var task = await VisibleTaskAsync(taskId, ct); if (task is null) return Fail<IReadOnlyList<TaskChecklistResponse>>("TASK_NOT_FOUND", "Task not found.");
        return Result<IReadOnlyList<TaskChecklistResponse>>.Success((await projects.ListChecklistAsync(taskId, ct)).Select(ToChecklist).ToList());
    }
    public async Task<Result<TaskChecklistResponse>> CreateChecklistAsync(Guid taskId, CreateTaskChecklistRequest request, CancellationToken ct = default)
    {
        var task = await EditableTaskAsync(taskId, ct); if (task is null) return Fail<TaskChecklistResponse>("TASK_FORBIDDEN", "Task operation is not authorized.");
        var text = Text(request.Text, 1000); if (text is null) return Fail<TaskChecklistResponse>("VALIDATION_FAILED", "Checklist text is required.");
        var items = await projects.ListChecklistAsync(taskId, ct); if (items.Count >= 200) return Fail<TaskChecklistResponse>("TASK_CHECKLIST_LIMIT", "Checklist item limit reached.");
        var item = new TaskChecklistItem { TaskItemId = task.Id, Text = text, SortKey = items.Count == 0 ? 1024 : items.Max(x => x.SortKey) + 1024 };
        await projects.AddChecklistItemAsync(item, ct); if (await CommitAsync(task, "TaskChecklistCreated", "checklistChanged", new Dictionary<string, object?> { ["completed"] = false }, ct) != TaskCommandSaveResult.Saved) return Fail<TaskChecklistResponse>("TASK_STALE_VERSION", "Task has changed. Refetch and retry."); return Result<TaskChecklistResponse>.Success(ToChecklist(item));
    }
    public async Task<Result<TaskChecklistResponse>> UpdateChecklistAsync(Guid taskId, Guid itemId, UpdateTaskChecklistRequest request, CancellationToken ct = default)
    {
        var task = await EditableTaskAsync(taskId, ct); var item = await projects.GetChecklistItemAsync(itemId, ct);
        if (task is null || item is null || item.TaskItemId != taskId) return Fail<TaskChecklistResponse>("TASK_CHECKLIST_ITEM_NOT_FOUND", "Checklist item not found.");
        if (item.VersionNo != request.ExpectedVersion) return Fail<TaskChecklistResponse>("TASK_STALE_VERSION", "Checklist item has changed. Refetch and retry.");
        if (request.Text is not null) { var text = Text(request.Text, 1000); if (text is null) return Fail<TaskChecklistResponse>("VALIDATION_FAILED", "Checklist text is required."); item.Text = text; }
        if (request.IsCompleted.HasValue && request.IsCompleted.Value != item.IsCompleted) { item.IsCompleted = request.IsCompleted.Value; item.CompletedAt = item.IsCompleted ? clock.UtcNow : null; item.CompletedByUserId = item.IsCompleted ? Actor() : null; }
        item.VersionNo++; if (await CommitAsync(task, "TaskChecklistUpdated", "checklistChanged", new Dictionary<string, object?> { ["completed"] = item.IsCompleted }, ct) != TaskCommandSaveResult.Saved) return Fail<TaskChecklistResponse>("TASK_STALE_VERSION", "Task has changed. Refetch and retry."); return Result<TaskChecklistResponse>.Success(ToChecklist(item));
    }
    public async Task<Result> DeleteChecklistAsync(Guid taskId, Guid itemId, long expectedVersion, CancellationToken ct = default)
    {
        var task = await EditableTaskAsync(taskId, ct); var item = await projects.GetChecklistItemAsync(itemId, ct);
        if (task is null || item is null || item.TaskItemId != taskId) return Fail("TASK_CHECKLIST_ITEM_NOT_FOUND", "Checklist item not found.");
        if (item.VersionNo != expectedVersion) return Fail("TASK_STALE_VERSION", "Checklist item has changed. Refetch and retry."); projects.RemoveChecklistItem(item); if (await CommitAsync(task, "TaskChecklistDeleted", "checklistChanged", null, ct) != TaskCommandSaveResult.Saved) return Fail("TASK_STALE_VERSION", "Task has changed. Refetch and retry."); return Result.Success();
    }
    public async Task<Result<TaskChecklistOrderResponse>> ReorderChecklistAsync(Guid taskId, ReorderTaskChecklistRequest request, CancellationToken ct = default)
    {
        var task = await EditableTaskAsync(taskId, ct);
        if (task is null) return Fail<TaskChecklistOrderResponse>("TASK_FORBIDDEN", "Task operation is not authorized.");
        if (task.VersionNo != request.ExpectedTaskVersion) return Fail<TaskChecklistOrderResponse>("TASK_STALE_VERSION", "Task has changed. Refetch and retry.");
        var items = await projects.ListChecklistAsync(taskId, ct);
        var orderedIds = request.OrderedItemIds ?? [];
        if (orderedIds.Count != items.Count || orderedIds.Distinct().Count() != orderedIds.Count || !orderedIds.All(id => items.Any(item => item.Id == id)))
            return Fail<TaskChecklistOrderResponse>("TASK_CHECKLIST_ORDER_INVALID", "Checklist order must contain each current item exactly once.");
        var byId = items.ToDictionary(item => item.Id);
        for (var index = 0; index < orderedIds.Count; index++) { var item = byId[orderedIds[index]]; item.SortKey = (index + 1) * 1024L; item.VersionNo++; }
        if (await CommitAsync(task, "TaskChecklistReordered", "checklistChanged", new Dictionary<string, object?> { ["itemCount"] = items.Count }, ct) != TaskCommandSaveResult.Saved) return Fail<TaskChecklistOrderResponse>("TASK_STALE_VERSION", "Task has changed. Refetch and retry.");
        return Result<TaskChecklistOrderResponse>.Success(new(orderedIds.Select(id => ToChecklist(byId[id])).ToList(), task.VersionNo));
    }
    public async Task<Result<TaskCommentPage>> ListCommentsAsync(Guid taskId, int page, int pageSize, CancellationToken ct = default)
    {
        var task = await VisibleTaskAsync(taskId, ct); if (task is null) return Fail<TaskCommentPage>("TASK_NOT_FOUND", "Task not found."); page = Math.Max(1, page); pageSize = Math.Clamp(pageSize, 1, 100); var actor = Actor();
        var items = await projects.ListTaskCommentsAsync(taskId, (page - 1) * pageSize, pageSize, ct); var canManage = await projectAuthorization.CanManageProject(actor, task.ProjectId, ct);
        var totalCount = await projects.CountTaskCommentsAsync(taskId, ct);
        return Result<TaskCommentPage>.Success(new TaskCommentPage(await ToCommentsAsync(items, actor, canManage, task.ProjectId, ct), page, pageSize, totalCount, page * pageSize < totalCount));
    }
    public async Task<Result<TaskCommentResponse?>> GetCommentForCompatibilityAsync(Guid commentId, CancellationToken ct = default)
    {
        var comment = await projects.GetTaskCommentAsync(commentId, ct);
        if (comment is null) return Result<TaskCommentResponse?>.Success(null);
        if (comment.TaskItem is null || await VisibleTaskAsync(comment.TaskItemId, ct) is null) return Fail<TaskCommentResponse?>("TASK_COMMENT_FORBIDDEN", "Comment operation is not authorized.");
        var canManage = await projectAuthorization.CanManageProject(Actor(), comment.ProjectId, ct);
        return Result<TaskCommentResponse?>.Success((await ToCommentsAsync([comment], Actor(), canManage, comment.ProjectId, ct))[0]);
    }
    public async Task<Result<TaskCommentResponse>> CreateCommentAsync(Guid taskId, CreateTaskCommentRequest request, CancellationToken ct = default)
    {
        var task = await VisibleTaskAsync(taskId, ct); if (task is null || !await commentAuthorization.CanCommentOnTarget(Actor(), AipPortal.Domain.Enums.CommentTargetType.TaskItem, taskId, ct)) return Fail<TaskCommentResponse>("TASK_FORBIDDEN", "Task operation is not authorized.");
        var body = Text(request.BodyPlainText, 12000); if (body is null) return Fail<TaskCommentResponse>("VALIDATION_FAILED", "Comment body is required.");
        var safety = safetyGuard.CheckMessagePost(new CommunicationSafetyScope(Actor(), task.TenantId, task.WorkspaceId, task.Id), body, clock.UtcNow);
        if (!safety.IsAllowed) return safety.ReasonCode == "duplicate_post"
            ? Fail<TaskCommentResponse>("TASK_COMMENT_DUPLICATE", "Comment submission was rejected by the communication safety policy.")
            : Result<TaskCommentResponse>.Failure(new ApplicationErrorDetail("TASK_COMMENT_RATE_LIMITED", "Comment submission was rejected by the communication safety policy.", Math.Max(1, safety.RetryAfterSeconds ?? 1)));
        if (!await MentionsAreEligibleAsync(body, task, ct)) return Fail<TaskCommentResponse>("TASK_MENTION_NOT_ELIGIBLE", "One or more mentions are not available for this task.");
        var comment = new TaskComment { TaskItemId = task.Id, WorkspaceId = task.WorkspaceId, ProjectId = task.ProjectId, AuthorUserId = Actor(), BodyPlainText = body, IsImportant = request.IsImportant, CreatedAt = clock.UtcNow };
        await projects.AddTaskCommentAsync(comment, ct); if (await CommitAsync(task, "TaskCommentCreated", "commentChanged", new Dictionary<string, object?> { ["important"] = request.IsImportant }, ct) != TaskCommandSaveResult.Saved) return Fail<TaskCommentResponse>("TASK_STALE_VERSION", "Task has changed. Refetch and retry."); return Result<TaskCommentResponse>.Success((await ToCommentsAsync([comment], Actor(), false, task.ProjectId, ct))[0]);
    }
    public async Task<Result<TaskCommentResponse>> UpdateCommentAsync(Guid commentId, UpdateTaskCommentRequest request, CancellationToken ct = default)
    {
        var comment = await projects.GetTaskCommentAsync(commentId, ct); if (comment?.TaskItem is null || !await CanEditCommentAsync(comment, ct)) return Fail<TaskCommentResponse>("TASK_COMMENT_FORBIDDEN", "Comment operation is not authorized.");
        if (comment.VersionNo != request.ExpectedVersion) return Fail<TaskCommentResponse>("TASK_STALE_VERSION", "Comment has changed. Refetch and retry.");
        if (request.BodyPlainText is not null) { var body = Text(request.BodyPlainText, 12000); if (body is null) return Fail<TaskCommentResponse>("VALIDATION_FAILED", "Comment body is required."); var safety = safetyGuard.CheckMessagePost(new CommunicationSafetyScope(Actor(), comment.TaskItem.TenantId, comment.TaskItem.WorkspaceId, comment.TaskItem.Id), body, clock.UtcNow); if (!safety.IsAllowed) return safety.ReasonCode == "duplicate_post" ? Fail<TaskCommentResponse>("TASK_COMMENT_DUPLICATE", "Comment submission was rejected by the communication safety policy.") : Result<TaskCommentResponse>.Failure(new ApplicationErrorDetail("TASK_COMMENT_RATE_LIMITED", "Comment submission was rejected by the communication safety policy.", Math.Max(1, safety.RetryAfterSeconds ?? 1))); if (!await MentionsAreEligibleAsync(body, comment.TaskItem, ct)) return Fail<TaskCommentResponse>("TASK_MENTION_NOT_ELIGIBLE", "One or more mentions are not available for this task."); comment.BodyPlainText = body; }
        if (request.IsImportant.HasValue) comment.IsImportant = request.IsImportant.Value; comment.UpdatedAt = clock.UtcNow; comment.VersionNo++;
        if (await CommitAsync(comment.TaskItem, "TaskCommentUpdated", "commentChanged", new Dictionary<string, object?> { ["important"] = comment.IsImportant }, ct) != TaskCommandSaveResult.Saved) return Fail<TaskCommentResponse>("TASK_STALE_VERSION", "Task has changed. Refetch and retry."); return Result<TaskCommentResponse>.Success((await ToCommentsAsync([comment], Actor(), await projectAuthorization.CanManageProject(Actor(), comment.ProjectId, ct), comment.ProjectId, ct))[0]);
    }
    public async Task<Result> DeleteCommentAsync(Guid commentId, long expectedVersion, CancellationToken ct = default)
    {
        var comment = await projects.GetTaskCommentAsync(commentId, ct); if (comment?.TaskItem is null || !await CanEditCommentAsync(comment, ct)) return Fail("TASK_COMMENT_FORBIDDEN", "Comment operation is not authorized.");
        if (comment.VersionNo != expectedVersion) return Fail("TASK_STALE_VERSION", "Comment has changed. Refetch and retry."); comment.MarkDeleted(clock.UtcNow, Actor()); comment.VersionNo++;
        if (await CommitAsync(comment.TaskItem, "TaskCommentDeleted", "commentChanged", null, ct) != TaskCommandSaveResult.Saved) return Fail("TASK_STALE_VERSION", "Task has changed. Refetch and retry."); return Result.Success();
    }
    public async Task<Result<IReadOnlyList<TaskMentionCandidateResponse>>> SearchMentionCandidatesAsync(Guid taskId, string? query, int limit = 10, CancellationToken ct = default)
    {
        var task = await VisibleTaskAsync(taskId, ct);
        if (task is null || !await commentAuthorization.CanCommentOnTarget(Actor(), CommentTargetType.TaskItem, taskId, ct)) return Fail<IReadOnlyList<TaskMentionCandidateResponse>>("TASK_NOT_FOUND", "Task not found.");
        var text = query?.Trim(); if (string.IsNullOrWhiteSpace(text)) return Result<IReadOnlyList<TaskMentionCandidateResponse>>.Success([]);
        if (text.Length > 100) return Fail<IReadOnlyList<TaskMentionCandidateResponse>>("VALIDATION_FAILED", "Mention query must be 100 characters or fewer.");
        var candidates = await projects.SearchMentionCandidatesAsync(task.ProjectId, text, Math.Clamp(limit, 1, 20), ct);
        return Result<IReadOnlyList<TaskMentionCandidateResponse>>.Success(candidates.Select(candidate => new TaskMentionCandidateResponse(candidate.Id, candidate.DisplayName)).ToList());
    }
    public async Task<Result<IReadOnlyList<ProjectTaskLabelResponse>>> ListLabelsAsync(Guid projectId, bool includeArchived, CancellationToken ct = default)
    { if (!await projectAuthorization.CanViewProject(Actor(), projectId, ct)) return Fail<IReadOnlyList<ProjectTaskLabelResponse>>("TASK_NOT_FOUND", "Project not found."); return Result<IReadOnlyList<ProjectTaskLabelResponse>>.Success((await projects.ListTaskLabelsAsync(projectId, includeArchived, ct)).Select(ToLabel).ToList()); }
    public async Task<Result<ProjectTaskLabelResponse>> CreateLabelAsync(Guid projectId, CreateProjectTaskLabelRequest request, CancellationToken ct = default)
    {
        var project = await ManagedProjectAsync(projectId, ct); if (project is null) return Fail<ProjectTaskLabelResponse>("TASK_LABEL_FORBIDDEN", "Label operation is not authorized."); var name = Text(request.Name, 120); if (name is null) return Fail<ProjectTaskLabelResponse>("VALIDATION_FAILED", "Label name is required.");
        var labels = await projects.ListTaskLabelsAsync(projectId, true, ct); if (labels.Any(x => string.Equals(x.Name.Trim(), name, StringComparison.OrdinalIgnoreCase))) return Fail<ProjectTaskLabelResponse>("TASK_LABEL_DUPLICATE", "A label with that name already exists.");
        var label = new ProjectTaskLabel { WorkspaceId = project.WorkspaceId, ProjectId = projectId, Name = name, Description = NullableText(request.Description, 1000), SortKey = request.SortKey ?? (labels.Count == 0 ? 1024 : labels.Max(x => x.SortKey) + 1024), VersionNo = 1 };
        await projects.AddTaskLabelAsync(label, ct);
        return await CommitLabelDefinitionAsync(project, label, "TaskLabelCreated", "taskLabelsChanged", ct) == TaskCommandSaveResult.Saved
            ? Result<ProjectTaskLabelResponse>.Success(ToLabel(label))
            : Fail<ProjectTaskLabelResponse>("TASK_LABEL_DUPLICATE", "A label with that name already exists.");
    }
    public async Task<Result<ProjectTaskLabelResponse>> UpdateLabelAsync(Guid projectId, Guid labelId, UpdateProjectTaskLabelRequest request, CancellationToken ct = default)
    {
        var project = await ManagedProjectAsync(projectId, ct); var label = await ManagedLabelAsync(projectId, labelId, ct);
        if (project is null || label is null) return Fail<ProjectTaskLabelResponse>("TASK_LABEL_FORBIDDEN", "Label operation is not authorized.");
        if (!request.ExpectedVersion.HasValue || request.ExpectedVersion.Value <= 0) return Fail<ProjectTaskLabelResponse>("TASK_INVALID_EXPECTED_VERSION", "Expected version is required and must be a positive integer.");
        if (label.VersionNo != request.ExpectedVersion.Value) return Fail<ProjectTaskLabelResponse>("TASK_STALE_VERSION", "Label has changed. Refetch and retry.");
        if (request.Name.IsSpecified)
        {
            var name = Text(request.Name.Value, 120); if (name is null) return Fail<ProjectTaskLabelResponse>("VALIDATION_FAILED", "Label name is required.");
            if ((await projects.ListTaskLabelsAsync(projectId, true, ct)).Any(x => x.Id != label.Id && string.Equals(x.Name.Trim(), name, StringComparison.OrdinalIgnoreCase))) return Fail<ProjectTaskLabelResponse>("TASK_LABEL_DUPLICATE", "A label with that name already exists.");
            label.Name = name;
        }
        if (request.Description.IsSpecified)
        {
            if (request.Description.Value is not null && request.Description.Value.Trim().Length > 1000)
                return Fail<ProjectTaskLabelResponse>("VALIDATION_FAILED", "Label description must be 1000 characters or fewer.");
            label.Description = NullableText(request.Description.Value, 1000);
        }
        if (request.SortKey.IsSpecified)
        {
            if (!request.SortKey.Value.HasValue || request.SortKey.Value.Value < 0) return Fail<ProjectTaskLabelResponse>("VALIDATION_FAILED", "Label sort key must be a non-negative integer.");
            label.SortKey = request.SortKey.Value.Value;
        }
        label.VersionNo++;
        var save = await CommitLabelDefinitionAsync(project, label, "TaskLabelUpdated", "taskLabelsChanged", ct);
        return save == TaskCommandSaveResult.Saved ? Result<ProjectTaskLabelResponse>.Success(ToLabel(label)) : save == TaskCommandSaveResult.UniqueConflict ? Fail<ProjectTaskLabelResponse>("TASK_LABEL_DUPLICATE", "A label with that name already exists.") : Fail<ProjectTaskLabelResponse>("TASK_STALE_VERSION", "Label has changed. Refetch and retry.");
    }
    public async Task<Result<ProjectTaskLabelResponse>> SetLabelArchiveAsync(Guid projectId, Guid labelId, long expectedVersion, bool archived, CancellationToken ct = default)
    { var project=await ManagedProjectAsync(projectId,ct); var label=await ManagedLabelAsync(projectId,labelId,ct); if(project is null||label is null)return Fail<ProjectTaskLabelResponse>("TASK_LABEL_FORBIDDEN","Label operation is not authorized."); if(label.VersionNo!=expectedVersion)return Fail<ProjectTaskLabelResponse>("TASK_STALE_VERSION","Label has changed. Refetch and retry."); label.IsArchived=archived;label.VersionNo++;return await CommitLabelDefinitionAsync(project,label,archived?"TaskLabelArchived":"TaskLabelRestored","taskLabelsChanged",ct)==TaskCommandSaveResult.Saved?Result<ProjectTaskLabelResponse>.Success(ToLabel(label)):Fail<ProjectTaskLabelResponse>("TASK_STALE_VERSION","Label has changed. Refetch and retry."); }
    public async Task<Result> ApplyLabelAsync(Guid taskId, Guid labelId, TaskLabelAssociationRequest request, CancellationToken ct = default)
    { var task=await EditableTaskAsync(taskId,ct); var label=await projects.GetTaskLabelAsync(labelId,ct); if(task is null||label is null)return Fail("TASK_LABEL_NOT_FOUND","Label not found."); if(task.VersionNo!=request.ExpectedVersion)return Fail("TASK_STALE_VERSION","Task has changed. Refetch and retry."); if(label.ProjectId!=task.ProjectId)return Fail("TASK_LABEL_PROJECT_MISMATCH","Label is not available for this task.");if(label.IsArchived)return Fail("TASK_LABEL_ARCHIVED","Archived labels cannot be applied.");if(!(await projects.ListWorkItemLabelsAsync(taskId,ct)).Any(x=>x.LabelId==labelId)){await projects.AddWorkItemLabelAsync(new WorkItemLabel{TaskItemId=taskId,LabelId=labelId,AddedAt=clock.UtcNow,AddedByUserId=Actor()},ct);var save=await CommitAsync(task,"TaskLabelApplied","labelsChanged",new Dictionary<string, object?>{["labelId"]=labelId},ct);if(save==TaskCommandSaveResult.UniqueConflict&&(await projects.ListWorkItemLabelsAsync(taskId,ct)).Any(x=>x.LabelId==labelId))return Result.Success();if(save!=TaskCommandSaveResult.Saved)return Fail("TASK_STALE_VERSION","Task has changed. Refetch and retry.");}return Result.Success(); }
    public async Task<Result> RemoveLabelAsync(Guid taskId, Guid labelId, long expectedVersion, CancellationToken ct = default)
    { var task=await EditableTaskAsync(taskId,ct); if(task is null)return Fail("TASK_LABEL_FORBIDDEN","Task operation is not authorized.");if(task.VersionNo!=expectedVersion)return Fail("TASK_STALE_VERSION","Task has changed. Refetch and retry.");var association=(await projects.ListWorkItemLabelsAsync(taskId,ct)).FirstOrDefault(x=>x.LabelId==labelId);if(association is not null){projects.RemoveWorkItemLabel(association);if(await CommitAsync(task,"TaskLabelRemoved","labelsChanged",new Dictionary<string, object?>{["labelId"]=labelId},ct)!=TaskCommandSaveResult.Saved)return Fail("TASK_STALE_VERSION","Task has changed. Refetch and retry.");}return Result.Success(); }
    public async Task<TaskSubresourceSummary> GetSummaryAsync(Guid taskId, CancellationToken ct = default) { var checklist=await projects.ListChecklistAsync(taskId,ct);return new(checklist.Count(x=>x.IsCompleted),checklist.Count,await projects.CountTaskCommentsAsync(taskId,ct),(await projects.ListWorkItemLabelsAsync(taskId,ct)).Count,(await projects.ListTasksAsync((await projects.GetTaskAsync(taskId,ct))?.ProjectId??Guid.Empty,ct)).Count(x=>x.ParentTaskItemId==taskId)); }
    private async Task<TaskItem?> VisibleTaskAsync(Guid taskId,CancellationToken ct){var task=await projects.GetTaskAsync(taskId,ct);return task is not null&&!task.DeletedAt.HasValue&&await projectAuthorization.CanViewProject(Actor(),task.ProjectId,ct)?task:null;}
    private async Task<TaskItem?> EditableTaskAsync(Guid taskId,CancellationToken ct){var task=await VisibleTaskAsync(taskId,ct);return task is not null&&await taskAuthorization.CanUpdateTask(Actor(),taskId,ct)?task:null;}
    private async Task<Project?> ManagedProjectAsync(Guid projectId,CancellationToken ct){var p=await projects.GetProjectAsync(projectId,ct);return p is not null&&await projectAuthorization.CanManageProject(Actor(),projectId,ct)?p:null;}
    private async Task<ProjectTaskLabel?> ManagedLabelAsync(Guid projectId,Guid labelId,CancellationToken ct){if(await ManagedProjectAsync(projectId,ct) is null)return null;var l=await projects.GetTaskLabelAsync(labelId,ct);return l?.ProjectId==projectId?l:null;}
    private async Task<bool> CanEditCommentAsync(TaskComment c,CancellationToken ct)=>!c.DeletedAt.HasValue&&(c.AuthorUserId==Actor()||await projectAuthorization.CanManageProject(Actor(),c.ProjectId,ct));
    private async Task<bool> MentionsAreEligibleAsync(string body, TaskItem task, CancellationToken ct)
    {
        var ids = MentionIds(body);
        return (await projects.GetEligibleMentionUsersAsync(task.ProjectId, ids, ct)).Select(user => user.Id).ToHashSet().SetEquals(ids);
    }
    private async Task<TaskCommandSaveOutcome> CommitLabelDefinitionAsync(Project project, ProjectTaskLabel label, string action, string change, CancellationToken ct)
    {
        await audit.LogAsync(action, "ProjectTaskLabel", label.Id, metadata: new Dictionary<string, object?> { ["projectId"] = project.Id, ["labelVersion"] = label.VersionNo }, cancellationToken: ct);
        await invalidations.ProjectChangedAsync(project, Actor(), change, ct);
        return await taskUnitOfWork.SaveTaskCommandAsync(ct);
    }
    private async Task<TaskCommandSaveOutcome> CommitAsync(TaskItem task,string action,string change,IReadOnlyDictionary<string,object?>? metadata,CancellationToken ct)
    {
        task.VersionNo++;
        await audit.LogAsync(new AuditLogEntry(Actor(),action,"TaskItem",task.Id,WorkspaceId:task.WorkspaceId,ProjectId:task.ProjectId,Metadata:metadata),ct);
        await invalidations.TaskChangedAsync(task,Actor(),change,cancellationToken:ct);
        await AdvanceParentForChildMutationAsync(task, action, ct);
        return await taskUnitOfWork.SaveTaskCommandAsync(ct);
    }

    private async Task<bool> CommitSubtaskCreationAsync(TaskItem parent, TaskItem child, CancellationToken ct)
    {
        await audit.LogAsync(new AuditLogEntry(Actor(), "TaskCreated", "TaskItem", child.Id,
            WorkspaceId: child.WorkspaceId, ProjectId: child.ProjectId,
            Metadata: new Dictionary<string, object?> { ["parentTaskId"] = parent.Id, ["initialVersion"] = child.VersionNo }), ct);
        await invalidations.TaskChangedAsync(child, Actor(), "created", affectedUserIds: [Actor()], cancellationToken: ct);
        await AdvanceParentForChildMutationAsync(child, "TaskCreated", ct);
        return await taskUnitOfWork.SaveTaskCommandAsync(ct) == TaskCommandSaveResult.Saved;
    }

    private async Task AdvanceParentForChildMutationAsync(TaskItem child, string childAction, CancellationToken ct)
    {
        if (!child.ParentTaskItemId.HasValue)
            return;

        var parent = await projects.GetTaskAsync(child.ParentTaskItemId.Value, ct);
        if (parent is null || parent.DeletedAt.HasValue)
            return;

        parent.VersionNo++;
        await audit.LogAsync(new AuditLogEntry(Actor(), "TaskSubtasksChanged", "TaskItem", parent.Id,
            WorkspaceId: parent.WorkspaceId, ProjectId: parent.ProjectId,
            Metadata: new Dictionary<string, object?> { ["childTaskId"] = child.Id, ["childAction"] = childAction, ["versionBefore"] = parent.VersionNo - 1 }), ct);
        await invalidations.TaskChangedAsync(parent, Actor(), "subtasksChanged", cancellationToken: ct);
    }
    private Guid Actor()=>currentUser.IsAuthenticated?currentUser.UserId??Guid.Empty:Guid.Empty; private static string? Text(string? s,int max)=>string.IsNullOrWhiteSpace(s)||s.Trim().Length>max?null:s.Trim();private static string? NullableText(string? s,int max)=>string.IsNullOrWhiteSpace(s)?null:s.Trim().Length>max?null:s.Trim();
    private static TaskChecklistResponse ToChecklist(TaskChecklistItem x)=>new(x.Id,x.Text,x.IsCompleted,x.CompletedAt,x.CompletedByUserId,x.SortKey,x.VersionNo); private static ProjectTaskLabelResponse ToLabel(ProjectTaskLabel x)=>new(x.Id,x.Name,x.Description,x.SortKey,x.IsArchived,x.VersionNo);
    private async Task<TaskSubtaskResponse> ToSubtaskAsync(TaskItem x, CancellationToken ct)
    {
        var assignee = x.PrimaryAssigneeUserId.HasValue ? await users.GetByIdAsync(x.PrimaryAssigneeUserId.Value, ct) : null;
        var stage = x.WorkflowStage ?? (x.WorkflowStageId.HasValue ? await projects.GetWorkflowStageAsync(x.WorkflowStageId.Value, ct) : null);
        var plannedEnd = x.PlannedEndDate ?? x.DueDate;
        var timeZone = await timeZones.ResolveAsync(x.TenantId, x.WorkspaceId, ct);
        var category = stage?.InternalCategory ?? (x.Status == TaskItemStatus.Completed ? TaskStageCategory.Done : x.Status == TaskItemStatus.Cancelled ? TaskStageCategory.Cancelled : TaskStageCategory.Todo);
        var overdue = TaskDeadlineCalculator.IsOverdue(x, category, timeZone, clock.UtcNow, plannedEnd);
        return new(x.Id, x.ParentTaskItemId ?? Guid.Empty, x.Title, x.WorkflowStageId, stage?.Name ?? string.Empty, (stage?.InternalCategory ?? TaskStageCategory.Todo).ToString(), x.Priority.ToString(), x.ProgressPercent, assignee is null ? null : new TaskPersonSummary(assignee.Id, assignee.DisplayName), plannedEnd, x.DeadlineAt, overdue, x.VersionNo);
    }
    private async Task<TaskFileAssociationResponse> ToFileAsync(Attachment x, CancellationToken ct)
    {
        var file = x.FileObject;
        if (file is null || file.DeletedAt.HasValue || file.Status == FileObjectStatus.Deleted) return new(x.Id, x.FileObjectId, x.FileName, x.ContentType, x.SizeBytes, x.ScanStatus.ToString(), x.CreatedAt, "Missing", false, false, true, "FILE_MISSING");
        if (file.Status == FileObjectStatus.Quarantined || x.ScanStatus == FileScanStatus.Infected) return new(x.Id, x.FileObjectId, x.FileName, x.ContentType, x.SizeBytes, x.ScanStatus.ToString(), x.CreatedAt, "Quarantined", false, false, true, "QUARANTINED");
        if (x.ScanStatus != FileScanStatus.Clean) return new(x.Id, x.FileObjectId, x.FileName, x.ContentType, x.SizeBytes, x.ScanStatus.ToString(), x.CreatedAt, "ScanPending", false, false, true, "SCAN_PENDING");
        var canOpen = await fileAuthorization.CanViewAttachment(Actor(), x, ct);
        var canRequestDownloadGrant = await fileAuthorization.CanDownloadAttachment(Actor(), x, ct);
        return new(x.Id, x.FileObjectId, x.FileName, x.ContentType, x.SizeBytes, x.ScanStatus.ToString(), x.CreatedAt, canOpen ? "Available" : "AccessRevoked", canOpen, canRequestDownloadGrant, true, canOpen ? null : "ACCESS_REVOKED");
    }
    private async Task<IReadOnlyList<TaskCommentResponse>> ToCommentsAsync(IReadOnlyList<TaskComment> comments, Guid actor, bool manager, Guid projectId, CancellationToken ct)
    {
        var mentionIds = comments.Where(comment => !comment.DeletedAt.HasValue).SelectMany(comment => MentionIds(comment.BodyPlainText)).Distinct().ToArray();
        var mentions = (await projects.GetEligibleMentionUsersAsync(projectId, mentionIds, ct)).ToDictionary(user => user.Id, user => user.DisplayName);
        return comments.Select(comment => new TaskCommentResponse(comment.Id, comment.TaskItemId, comment.AuthorUser is null ? null : new TaskPersonSummary(comment.AuthorUser.Id, comment.AuthorUser.DisplayName), comment.DeletedAt.HasValue ? null : comment.BodyPlainText, comment.IsImportant, comment.CreatedAt, comment.UpdatedAt, comment.DeletedAt, comment.VersionNo, !comment.DeletedAt.HasValue && (comment.AuthorUserId == actor || manager), !comment.DeletedAt.HasValue && (comment.AuthorUserId == actor || manager), !comment.DeletedAt.HasValue && (comment.AuthorUserId == actor || manager), comment.DeletedAt.HasValue ? [] : MentionIds(comment.BodyPlainText).Where(mentions.ContainsKey).Select(id => new TaskCommentMentionResponse(id, mentions[id])).ToArray())).ToArray();
    }
    private static IReadOnlyList<Guid> MentionIds(string? body) => MentionPattern.Matches(body ?? string.Empty).Select(match => Guid.TryParse(match.Groups["id"].Value, out var id) ? id : Guid.Empty).Where(id => id != Guid.Empty).Distinct().ToArray();
    private static Result<T> Fail<T>(string code,string message)=>Result<T>.Failure($"{code}|{message}");private static Result Fail(string code,string message)=>Result.Failure($"{code}|{message}");
    private static readonly Regex MentionPattern = new("@\\{(?<id>[0-9a-fA-F-]{36})\\}", RegexOptions.CultureInvariant | RegexOptions.Compiled);
}
