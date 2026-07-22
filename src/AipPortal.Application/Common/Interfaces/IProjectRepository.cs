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
    Task<TaskWorkflowDefinition?> GetWorkflowDefinitionAsync(Guid projectId, CancellationToken cancellationToken = default) => Task.FromResult<TaskWorkflowDefinition?>(null);
    Task<TaskWorkflowStage?> GetWorkflowStageAsync(Guid workflowStageId, CancellationToken cancellationToken = default) => Task.FromResult<TaskWorkflowStage?>(null);
    Task<IReadOnlyList<TaskWorkflowStage>> ListWorkflowStagesAsync(Guid projectId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<TaskWorkflowStage>>([]);
    Task<IReadOnlyList<WorkItemCollaborator>> ListCollaboratorsAsync(Guid taskItemId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<WorkItemCollaborator>>([]);
    Task<IReadOnlyList<TaskAssignment>> ListAssignmentsAsync(Guid taskItemId, CancellationToken cancellationToken = default);
    Task<TaskAssignment?> GetAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<TaskDependency>> ListDependenciesAsync(Guid taskItemId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<TaskDependency>> ListProjectDependenciesAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<TaskDependency?> GetDependencyAsync(Guid dependencyId, CancellationToken cancellationToken = default);
    Task<bool> DependencyExistsAsync(Guid predecessorTaskId, Guid successorTaskId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Comment>> ListCommentsAsync(CommentTargetType targetType, Guid targetId, CancellationToken cancellationToken = default);
    Task<Comment?> GetCommentAsync(Guid commentId, CancellationToken cancellationToken = default);
    Task<WorkItemWatchState?> GetWatchStateAsync(Guid taskItemId, Guid userId, CancellationToken cancellationToken = default) => Task.FromResult<WorkItemWatchState?>(null);
    Task<IReadOnlyList<WorkItemWatchState>> ListWatchStatesAsync(Guid taskItemId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<WorkItemWatchState>>([]);
    Task<IReadOnlyList<TaskChecklistItem>> ListChecklistAsync(Guid taskItemId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<TaskChecklistItem>>([]);
    Task<TaskChecklistItem?> GetChecklistItemAsync(Guid itemId, CancellationToken cancellationToken = default) => Task.FromResult<TaskChecklistItem?>(null);
    Task<IReadOnlyList<TaskComment>> ListTaskCommentsAsync(Guid taskItemId, int skip, int take, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<TaskComment>>([]);
    Task<int> CountTaskCommentsAsync(Guid taskItemId, CancellationToken cancellationToken = default) => Task.FromResult(0);
    Task<TaskComment?> GetTaskCommentAsync(Guid commentId, CancellationToken cancellationToken = default) => Task.FromResult<TaskComment?>(null);
    Task<IReadOnlyList<ProjectTaskLabel>> ListTaskLabelsAsync(Guid projectId, bool includeArchived, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<ProjectTaskLabel>>([]);
    Task<ProjectTaskLabel?> GetTaskLabelAsync(Guid labelId, CancellationToken cancellationToken = default) => Task.FromResult<ProjectTaskLabel?>(null);
    Task<IReadOnlyList<WorkItemLabel>> ListWorkItemLabelsAsync(Guid taskItemId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<WorkItemLabel>>([]);
    Task<WorkItemLabel?> GetWorkItemLabelAsync(Guid associationId, CancellationToken cancellationToken = default) => Task.FromResult<WorkItemLabel?>(null);
    Task AddProjectAsync(Project project, CancellationToken cancellationToken = default);
    Task AddMemberAsync(ProjectMember member, CancellationToken cancellationToken = default);
    Task AddMilestoneAsync(Milestone milestone, CancellationToken cancellationToken = default);
    Task AddTaskAsync(TaskItem task, CancellationToken cancellationToken = default);
    Task AddCollaboratorAsync(WorkItemCollaborator collaborator, CancellationToken cancellationToken = default) => Task.CompletedTask;
    Task AddAssignmentAsync(TaskAssignment assignment, CancellationToken cancellationToken = default);
    Task AddDependencyAsync(TaskDependency dependency, CancellationToken cancellationToken = default);
    Task AddCommentAsync(Comment comment, CancellationToken cancellationToken = default);
    Task AddWatchStateAsync(WorkItemWatchState watchState, CancellationToken cancellationToken = default) => Task.CompletedTask;
    Task AddChecklistItemAsync(TaskChecklistItem item, CancellationToken cancellationToken = default) => Task.CompletedTask;
    Task AddTaskCommentAsync(TaskComment comment, CancellationToken cancellationToken = default) => Task.CompletedTask;
    Task AddTaskLabelAsync(ProjectTaskLabel label, CancellationToken cancellationToken = default) => Task.CompletedTask;
    Task AddWorkItemLabelAsync(WorkItemLabel association, CancellationToken cancellationToken = default) => Task.CompletedTask;
    void RemoveMember(ProjectMember member);
    void RemoveAssignment(TaskAssignment assignment);
    void RemoveDependency(TaskDependency dependency);
    void RemoveCollaborator(WorkItemCollaborator collaborator) { }
    void RemoveChecklistItem(TaskChecklistItem item) { }
    void RemoveWorkItemLabel(WorkItemLabel association) { }
}
