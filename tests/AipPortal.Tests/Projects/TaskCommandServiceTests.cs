using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Projects;
using AipPortal.Application.Realtime;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Tests.Projects;

public sealed class TaskCommandServiceTests
{
    [Fact]
    public async Task ChildProgressMutationAdvancesParentAndQueuesBothObservableChanges()
    {
        var fixture = Fixture.Create();
        var parent = fixture.AddTask("parent");
        var child = fixture.AddTask("child", parent.Id, progress: 20);

        var result = await fixture.Service.UpdateDetailsAsync(child.Id, new TaskUpdateDetailsRequest("child", null, TaskPriority.Medium, null, null, 45, child.VersionNo));

        Assert.True(result.IsSuccess);
        Assert.Equal(2, parent.VersionNo);
        Assert.Equal(2, child.VersionNo);
        Assert.Equal(1, fixture.UnitOfWork.SaveCount);
        Assert.Contains(fixture.Audit.Entries, entry => entry.EntityId == child.Id && entry.Action == "TaskDetailsUpdated");
        Assert.Contains(fixture.Audit.Entries, entry => entry.EntityId == parent.Id && entry.Action == "TaskSubtasksChanged");
        Assert.Contains(fixture.Invalidations.TaskChanges, change => change.TaskId == child.Id && change.Change == "updated");
        Assert.Contains(fixture.Invalidations.TaskChanges, change => change.TaskId == parent.Id && change.Change == "subtasksChanged");
    }

    [Fact]
    public async Task ChildCancellationAdvancesParentInTheSameCommandBoundary()
    {
        var fixture = Fixture.Create();
        var parent = fixture.AddTask("parent");
        var child = fixture.AddTask("child", parent.Id, progress: 20);
        var cancelled = new TaskWorkflowStage { ProjectId = fixture.Project.Id, Name = "Cancelled", InternalCategory = TaskStageCategory.Cancelled };
        fixture.Projects.Stages[cancelled.Id] = cancelled;

        var result = await fixture.Service.TransitionAsync(child.Id, new TaskTransitionRequest(cancelled.Id, child.VersionNo, "No longer required"));

        Assert.True(result.IsSuccess);
        Assert.Equal(2, parent.VersionNo);
        Assert.Equal(TaskItemStatus.Cancelled, child.Status);
        Assert.Equal(1, fixture.UnitOfWork.SaveCount);
        Assert.Contains(fixture.Audit.Entries, entry => entry.EntityId == parent.Id && entry.Action == "TaskSubtasksChanged");
        Assert.Contains(fixture.Invalidations.TaskChanges, change => change.TaskId == parent.Id && change.Change == "subtasksChanged");
    }

    [Fact]
    public async Task ReopenFromDoneClearsCompletionAndResetsTodoProgress()
    {
        var fixture = Fixture.Create();
        var task = fixture.AddTask("reopen", progress: 0);
        var done = new TaskWorkflowStage { ProjectId = fixture.Project.Id, Name = "Done", InternalCategory = TaskStageCategory.Done };
        var todo = new TaskWorkflowStage { ProjectId = fixture.Project.Id, Name = "Todo", InternalCategory = TaskStageCategory.Todo };
        fixture.Projects.Stages[done.Id] = done;
        fixture.Projects.Stages[todo.Id] = todo;

        Assert.True((await fixture.Service.TransitionAsync(task.Id, new TaskTransitionRequest(done.Id, task.VersionNo))).IsSuccess);
        var reopened = await fixture.Service.TransitionAsync(task.Id, new TaskTransitionRequest(todo.Id, task.VersionNo));

        Assert.True(reopened.IsSuccess);
        Assert.Equal(TaskItemStatus.NotStarted, task.Status);
        Assert.Equal(0, task.ProgressPercent);
        Assert.Null(task.CompletedAt);
        Assert.Equal(3, task.VersionNo);
        Assert.Contains(fixture.Invalidations.TaskChanges, change => change.TaskId == task.Id && change.Change == "reopened");
    }

    [Fact]
    public async Task ReopenFromCancelledClearsTerminalMetadataAndResetsBacklogProgress()
    {
        var fixture = Fixture.Create();
        var task = fixture.AddTask("reopen", progress: 35);
        var cancelled = new TaskWorkflowStage { ProjectId = fixture.Project.Id, Name = "Cancelled", InternalCategory = TaskStageCategory.Cancelled };
        var backlog = new TaskWorkflowStage { ProjectId = fixture.Project.Id, Name = "Backlog", InternalCategory = TaskStageCategory.Backlog };
        fixture.Projects.Stages[cancelled.Id] = cancelled;
        fixture.Projects.Stages[backlog.Id] = backlog;

        Assert.True((await fixture.Service.TransitionAsync(task.Id, new TaskTransitionRequest(cancelled.Id, task.VersionNo, "deferred"))).IsSuccess);
        var reopened = await fixture.Service.TransitionAsync(task.Id, new TaskTransitionRequest(backlog.Id, task.VersionNo));

        Assert.True(reopened.IsSuccess);
        Assert.Equal(0, task.ProgressPercent);
        Assert.Null(task.CancelledAt);
        Assert.Null(task.CancellationReason);
        Assert.Contains(fixture.Invalidations.TaskChanges, change => change.TaskId == task.Id && change.Change == "reopened");
    }

    [Fact]
    public async Task TerminalTaskCannotTransitionDirectlyToActiveWork()
    {
        var fixture = Fixture.Create();
        var task = fixture.AddTask("terminal", progress: 0);
        var done = new TaskWorkflowStage { ProjectId = fixture.Project.Id, Name = "Done", InternalCategory = TaskStageCategory.Done };
        var inProgress = new TaskWorkflowStage { ProjectId = fixture.Project.Id, Name = "In progress", InternalCategory = TaskStageCategory.InProgress };
        fixture.Projects.Stages[done.Id] = done;
        fixture.Projects.Stages[inProgress.Id] = inProgress;

        Assert.True((await fixture.Service.TransitionAsync(task.Id, new TaskTransitionRequest(done.Id, task.VersionNo))).IsSuccess);
        var version = task.VersionNo;
        var result = await fixture.Service.TransitionAsync(task.Id, new TaskTransitionRequest(inProgress.Id, version));

        Assert.False(result.IsSuccess);
        Assert.StartsWith("TASK_TRANSITION_GUARD_FAILED|", result.Error);
        Assert.Equal(version, task.VersionNo);
        Assert.Equal(TaskItemStatus.Completed, task.Status);
        Assert.Equal(100, task.ProgressPercent);
        Assert.Equal(1, fixture.UnitOfWork.SaveCount);
        Assert.Single(fixture.Audit.Entries);
        Assert.Single(fixture.Invalidations.TaskChanges);
    }

    [Fact]
    public async Task AllCancelledChildrenStillRejectDirectParentDerivedFieldChangesButAllowTitleUpdate()
    {
        var fixture = Fixture.Create();
        var parent = fixture.AddTask("parent", progress: 37);
        var child = fixture.AddTask("child", parent.Id, progress: 100);
        child.Status = TaskItemStatus.Cancelled;

        var rejected = await fixture.Service.UpdateDetailsAsync(parent.Id, new TaskUpdateDetailsRequest("renamed", null, TaskPriority.High, null, null, 37, parent.VersionNo));
        var accepted = await fixture.Service.UpdateDetailsAsync(parent.Id, new TaskUpdateDetailsRequest("renamed", null, TaskPriority.High, null, null, 0, parent.VersionNo));

        Assert.False(rejected.IsSuccess);
        Assert.StartsWith("TASK_PROGRESS_DERIVED|", rejected.Error);
        Assert.True(accepted.IsSuccess);
        Assert.Equal("renamed", parent.Title);
    }

    [Fact]
    public async Task DoneDerivedParentAcceptsOrdinaryEditsUsingAuthoritativeDerivedValues()
    {
        var fixture = Fixture.Create();
        var parent = fixture.AddTask("parent", progress: 100);
        parent.Status = TaskItemStatus.Completed;
        parent.PlannedStartDate = new DateOnly(2026, 7, 1);
        parent.PlannedEndDate = new DateOnly(2026, 7, 2);
        var child = fixture.AddTask("child", parent.Id, progress: 100);
        child.Status = TaskItemStatus.Cancelled;
        child.PlannedStartDate = new DateOnly(2026, 7, 4);
        child.PlannedEndDate = new DateOnly(2026, 7, 8);

        var result = await fixture.Service.UpdateDetailsAsync(parent.Id, new TaskUpdateDetailsRequest(
            "renamed", "updated description", TaskPriority.High, child.PlannedStartDate, child.PlannedEndDate, 0, parent.VersionNo));

        Assert.True(result.IsSuccess);
        Assert.Equal("renamed", parent.Title);
        Assert.Equal("updated description", parent.Description);
        Assert.Equal(TaskPriority.High, parent.Priority);
        Assert.Equal(100, parent.ProgressPercent);
        Assert.Equal(new DateOnly(2026, 7, 1), parent.PlannedStartDate);
        Assert.Equal(new DateOnly(2026, 7, 2), parent.PlannedEndDate);
        Assert.Equal(0, result.Value!.ProgressPercent);
        Assert.True(result.Value.ProgressIsDerived);
        Assert.Equal(child.PlannedStartDate, result.Value.PlannedStartDate);
        Assert.Equal(child.PlannedEndDate, result.Value.PlannedEndDate);
        Assert.Equal(2, parent.VersionNo);
        Assert.Equal(1, fixture.UnitOfWork.SaveCount);
        Assert.Contains(fixture.Audit.Entries, entry => entry.EntityId == parent.Id && entry.Action == "TaskDetailsUpdated");
        Assert.Contains(fixture.Invalidations.TaskChanges, change => change.TaskId == parent.Id && change.Change == "updated");
    }

    [Fact]
    public async Task CancelledDerivedParentAcceptsOrdinaryEditsUsingAuthoritativeDerivedValues()
    {
        var fixture = Fixture.Create();
        var parent = fixture.AddTask("parent", progress: 73);
        parent.Status = TaskItemStatus.Cancelled;
        parent.PlannedStartDate = new DateOnly(2026, 7, 1);
        parent.PlannedEndDate = new DateOnly(2026, 7, 2);
        var child = fixture.AddTask("child", parent.Id, progress: 100);
        child.Status = TaskItemStatus.Cancelled;
        child.PlannedStartDate = new DateOnly(2026, 7, 4);
        child.PlannedEndDate = new DateOnly(2026, 7, 8);

        var result = await fixture.Service.UpdateDetailsAsync(parent.Id, new TaskUpdateDetailsRequest(
            "renamed", "updated description", TaskPriority.High, child.PlannedStartDate, child.PlannedEndDate, 0, parent.VersionNo));

        Assert.True(result.IsSuccess);
        Assert.Equal("renamed", parent.Title);
        Assert.Equal("updated description", parent.Description);
        Assert.Equal(TaskPriority.High, parent.Priority);
        Assert.Equal(73, parent.ProgressPercent);
        Assert.Equal(new DateOnly(2026, 7, 1), parent.PlannedStartDate);
        Assert.Equal(new DateOnly(2026, 7, 2), parent.PlannedEndDate);
        Assert.Equal(0, result.Value!.ProgressPercent);
        Assert.True(result.Value.ProgressIsDerived);
        Assert.Equal(child.PlannedStartDate, result.Value.PlannedStartDate);
        Assert.Equal(child.PlannedEndDate, result.Value.PlannedEndDate);
        Assert.Equal(2, parent.VersionNo);
        Assert.Equal(1, fixture.UnitOfWork.SaveCount);
    }

    [Theory]
    [InlineData(TaskItemStatus.Completed)]
    [InlineData(TaskItemStatus.Cancelled)]
    public async Task TerminalDerivedParentRejectsNonAuthoritativeDerivedFieldChangesWithoutSideEffects(TaskItemStatus parentStatus)
    {
        var fixture = Fixture.Create();
        var parent = fixture.AddTask("parent", progress: 100);
        parent.Status = parentStatus;
        var child = fixture.AddTask("child", parent.Id, progress: 100);
        child.Status = TaskItemStatus.Cancelled;
        child.PlannedStartDate = new DateOnly(2026, 7, 4);
        child.PlannedEndDate = new DateOnly(2026, 7, 8);

        var result = await fixture.Service.UpdateDetailsAsync(parent.Id, new TaskUpdateDetailsRequest(
            "renamed", "updated description", TaskPriority.High, child.PlannedStartDate, child.PlannedEndDate, 1, parent.VersionNo));

        Assert.False(result.IsSuccess);
        Assert.StartsWith("TASK_PROGRESS_DERIVED|", result.Error);
        Assert.Equal("parent", parent.Title);
        Assert.Null(parent.Description);
        Assert.Equal(TaskPriority.Medium, parent.Priority);
        Assert.Equal(1, parent.VersionNo);
        Assert.Empty(fixture.Audit.Entries);
        Assert.Empty(fixture.Invalidations.TaskChanges);
        Assert.Equal(0, fixture.UnitOfWork.SaveCount);
    }

    [Fact]
    public async Task LeafDoneRequiresOneHundredProgressButAllowsOrdinaryEditsAtOneHundred()
    {
        var fixture = Fixture.Create();
        var task = fixture.AddTask("task", progress: 100);
        task.Status = TaskItemStatus.Completed;

        var rejected = await fixture.Service.UpdateDetailsAsync(task.Id, new TaskUpdateDetailsRequest(
            "renamed", "updated description", TaskPriority.High, null, null, 99, task.VersionNo));

        Assert.False(rejected.IsSuccess);
        Assert.StartsWith("TASK_INVALID_PROGRESS|", rejected.Error);
        Assert.Equal("task", task.Title);
        Assert.Equal(1, task.VersionNo);
        Assert.Empty(fixture.Audit.Entries);
        Assert.Empty(fixture.Invalidations.TaskChanges);
        Assert.Equal(0, fixture.UnitOfWork.SaveCount);

        var accepted = await fixture.Service.UpdateDetailsAsync(task.Id, new TaskUpdateDetailsRequest(
            "renamed", "updated description", TaskPriority.High, null, null, 100, task.VersionNo));

        Assert.True(accepted.IsSuccess);
        Assert.Equal("renamed", task.Title);
        Assert.Equal(2, task.VersionNo);
    }

    [Fact]
    public async Task LeafCancelledRejectsProgressChangesButAllowsOrdinaryEditsAtSavedProgress()
    {
        var fixture = Fixture.Create();
        var task = fixture.AddTask("task", progress: 37);
        task.Status = TaskItemStatus.Cancelled;

        var rejected = await fixture.Service.UpdateDetailsAsync(task.Id, new TaskUpdateDetailsRequest(
            "renamed", "updated description", TaskPriority.High, null, null, 38, task.VersionNo));

        Assert.False(rejected.IsSuccess);
        Assert.StartsWith("TASK_INVALID_PROGRESS|", rejected.Error);
        Assert.Equal("task", task.Title);
        Assert.Equal(1, task.VersionNo);
        Assert.Empty(fixture.Audit.Entries);
        Assert.Empty(fixture.Invalidations.TaskChanges);
        Assert.Equal(0, fixture.UnitOfWork.SaveCount);

        var accepted = await fixture.Service.UpdateDetailsAsync(task.Id, new TaskUpdateDetailsRequest(
            "renamed", "updated description", TaskPriority.High, null, null, 37, task.VersionNo));

        Assert.True(accepted.IsSuccess);
        Assert.Equal("renamed", task.Title);
        Assert.Equal(2, task.VersionNo);
    }

    [Fact]
    public async Task SaveConflictDoesNotReturnSuccessAndUnrelatedRootIsUnchanged()
    {
        var fixture = Fixture.Create();
        var changed = fixture.AddTask("changed");
        var unrelated = fixture.AddTask("unrelated");
        fixture.UnitOfWork.Result = TaskCommandSaveResult.ConcurrencyConflict;

        var result = await fixture.Service.UpdateDetailsAsync(changed.Id, new TaskUpdateDetailsRequest("changed", null, TaskPriority.Medium, null, null, 10, changed.VersionNo));

        Assert.False(result.IsSuccess);
        Assert.StartsWith("TASK_STALE_VERSION|", result.Error);
        Assert.Equal(1, fixture.UnitOfWork.SaveCount);
        Assert.Equal(1, unrelated.VersionNo);
    }

    [Fact]
    public async Task SubtaskCreationComposesChildCreatorWatchAndParentChangeInOneSave()
    {
        var fixture = Fixture.Create();
        var parent = fixture.AddTask("parent");

        var result = await fixture.Subresources.CreateSubtaskAsync(
            parent.Id,
            new CreateTaskSubtaskRequest("child", "description", TaskPriority.High));

        Assert.True(result.IsSuccess);
        var child = Assert.Single(fixture.Projects.Tasks.Values, task => task.ParentTaskItemId == parent.Id);
        Assert.Equal(parent.Id, child.ParentTaskItemId);
        var watch = Assert.Single(fixture.Projects.Watches);
        Assert.Equal(child.Id, watch.TaskItemId);
        Assert.Equal(fixture.Actor, watch.UserId);
        Assert.Equal(WorkItemWatchAutomaticSource.Creator, watch.AutomaticSources);
        Assert.True(watch.IsWatching);
        Assert.Contains(fixture.Audit.Entries, entry => entry.EntityId == child.Id && entry.Action == "TaskCreated");
        Assert.Contains(fixture.Audit.Entries, entry => entry.EntityId == parent.Id && entry.Action == "TaskSubtasksChanged");
        Assert.Contains(fixture.Invalidations.TaskChanges, change => change.TaskId == child.Id && change.Change == "created");
        Assert.Contains(fixture.Invalidations.TaskChanges, change => change.TaskId == parent.Id && change.Change == "subtasksChanged");
        Assert.Equal(2, parent.VersionNo);
        Assert.Equal(1, fixture.UnitOfWork.SaveCount);
    }

    [Fact]
    public async Task LabelPatchValidatesExpectedVersionBeforeQueuingSideEffectsAndPreservesPatchSemantics()
    {
        var fixture = Fixture.Create();
        var label = new ProjectTaskLabel
        {
            ProjectId = fixture.Project.Id,
            WorkspaceId = fixture.Project.WorkspaceId,
            Name = "Label",
            Description = "existing",
            VersionNo = 1
        };
        fixture.Projects.Labels[label.Id] = label;

        foreach (var invalidVersion in new long?[] { null, 0, -1 })
        {
            var invalid = await fixture.Subresources.UpdateLabelAsync(
                fixture.Project.Id,
                label.Id,
                new UpdateProjectTaskLabelRequest(default, default, default, invalidVersion));

            Assert.False(invalid.IsSuccess);
            Assert.StartsWith("TASK_INVALID_EXPECTED_VERSION|", invalid.Error);
        }

        var stale = await fixture.Subresources.UpdateLabelAsync(
            fixture.Project.Id,
            label.Id,
            new UpdateProjectTaskLabelRequest(default, default, default, 2));

        Assert.False(stale.IsSuccess);
        Assert.StartsWith("TASK_STALE_VERSION|", stale.Error);
        Assert.Equal("existing", label.Description);
        Assert.Empty(fixture.Audit.Entries);
        Assert.Empty(fixture.Invalidations.TaskChanges);
        Assert.Empty(fixture.Invalidations.ProjectChanges);
        Assert.Equal(0, fixture.UnitOfWork.SaveCount);

        var omitted = await fixture.Subresources.UpdateLabelAsync(
            fixture.Project.Id,
            label.Id,
            new UpdateProjectTaskLabelRequest(default, default, default, 1));
        Assert.True(omitted.IsSuccess);
        Assert.Equal("existing", label.Description);

        var trimmed = await fixture.Subresources.UpdateLabelAsync(
            fixture.Project.Id,
            label.Id,
            new UpdateProjectTaskLabelRequest(default, new OptionalString(true, "  updated  "), default, 2));
        Assert.True(trimmed.IsSuccess);
        Assert.Equal("updated", label.Description);

        var clearedByEmptyString = await fixture.Subresources.UpdateLabelAsync(
            fixture.Project.Id,
            label.Id,
            new UpdateProjectTaskLabelRequest(default, new OptionalString(true, string.Empty), default, 3));
        Assert.True(clearedByEmptyString.IsSuccess);
        Assert.Null(label.Description);

        var setAgain = await fixture.Subresources.UpdateLabelAsync(
            fixture.Project.Id,
            label.Id,
            new UpdateProjectTaskLabelRequest(default, new OptionalString(true, "again"), default, 4));
        Assert.True(setAgain.IsSuccess);

        var clearedByNull = await fixture.Subresources.UpdateLabelAsync(
            fixture.Project.Id,
            label.Id,
            new UpdateProjectTaskLabelRequest(default, new OptionalString(true, null), default, 5));
        Assert.True(clearedByNull.IsSuccess);
        Assert.Null(label.Description);

        var setBeforeWhitespaceClear = await fixture.Subresources.UpdateLabelAsync(
            fixture.Project.Id,
            label.Id,
            new UpdateProjectTaskLabelRequest(default, new OptionalString(true, "again"), default, 6));
        Assert.True(setBeforeWhitespaceClear.IsSuccess);

        var clearedByWhitespace = await fixture.Subresources.UpdateLabelAsync(
            fixture.Project.Id,
            label.Id,
            new UpdateProjectTaskLabelRequest(default, new OptionalString(true, " "), default, 7));
        Assert.True(clearedByWhitespace.IsSuccess);
        Assert.Null(label.Description);
    }

    private sealed class Fixture
    {
        private Fixture()
        {
            Actor = Guid.NewGuid();
            Project = new Project { WorkspaceId = Guid.NewGuid(), Name = "Project", Slug = "project", OwnerUserId = Actor, CreatedByUserId = Actor };
            Projects.ProjectItems[Project.Id] = Project;
            Service = new TaskCommandService(Projects, new FakeGroups(), Users, new AllowedProjectAuthorization(), new AllowedTaskAuthorization(), new FakeCurrentUser(Actor), new FixedClock(), Audit, Invalidations, UnitOfWork, new UtcTimeZoneResolver());
            Subresources = CreateSubresources();
        }

        public Guid Actor { get; }
        public Project Project { get; }
        public FakeProjects Projects { get; } = new();
        public FakeUsers Users { get; } = new();
        public FakeAudit Audit { get; } = new();
        public FakeInvalidations Invalidations { get; } = new();
        public FakeTaskUnitOfWork UnitOfWork { get; } = new();
        public TaskCommandService Service { get; }
        public TaskSubresourceService Subresources { get; }
        public static Fixture Create() => new();
        public TaskItem AddTask(string title, Guid? parentId = null, int progress = 0)
        {
            var item = new TaskItem { ProjectId = Project.Id, WorkspaceId = Project.WorkspaceId, CreatedByUserId = Actor, Title = title, ParentTaskItemId = parentId, ProgressPercent = progress, VersionNo = 1 };
            Projects.Tasks[item.Id] = item;
            return item;
        }

        private TaskSubresourceService CreateSubresources() => new(
            Projects,
            null!,
            new AllowedProjectAuthorization(),
            new AllowedTaskAuthorization(),
            null!,
            null!,
            null!,
            null!,
            null!,
            new FakeCurrentUser(Actor),
            new FixedClock(),
            Audit,
            Invalidations,
            UnitOfWork,
            new UtcTimeZoneResolver());
    }

    private sealed class FakeProjects : IProjectRepository
    {
        public Dictionary<Guid, Project> ProjectItems { get; } = [];
        public Dictionary<Guid, TaskItem> Tasks { get; } = [];
        public Dictionary<Guid, TaskWorkflowStage> Stages { get; } = [];
        public Dictionary<Guid, ProjectTaskLabel> Labels { get; } = [];
        public List<WorkItemWatchState> Watches { get; } = [];
        public Task<IReadOnlyList<Project>> ListVisibleAsync(Guid userId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<Project>>(ProjectItems.Values.ToArray());
        public Task<Project?> GetProjectAsync(Guid projectId, CancellationToken cancellationToken = default) => Task.FromResult(ProjectItems.GetValueOrDefault(projectId));
        public Task<ProjectMember?> GetMemberAsync(Guid projectId, Guid userId, CancellationToken cancellationToken = default) => Task.FromResult<ProjectMember?>(new ProjectMember { ProjectId = projectId, UserId = userId });
        public Task<IReadOnlyList<ProjectMember>> ListMembersAsync(Guid projectId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<ProjectMember>>([]);
        public Task<IReadOnlyList<Milestone>> ListMilestonesAsync(Guid projectId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<Milestone>>([]);
        public Task<Milestone?> GetMilestoneAsync(Guid milestoneId, CancellationToken cancellationToken = default) => Task.FromResult<Milestone?>(null);
        public Task<IReadOnlyList<TaskItem>> ListTasksAsync(Guid projectId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<TaskItem>>(Tasks.Values.Where(task => task.ProjectId == projectId).ToArray());
        public Task<TaskItem?> GetTaskAsync(Guid taskItemId, CancellationToken cancellationToken = default) => Task.FromResult(Tasks.GetValueOrDefault(taskItemId));
        public Task<TaskWorkflowStage?> GetWorkflowStageAsync(Guid workflowStageId, CancellationToken cancellationToken = default) => Task.FromResult(Stages.GetValueOrDefault(workflowStageId));
        public Task<IReadOnlyList<TaskWorkflowStage>> ListWorkflowStagesAsync(Guid projectId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<TaskWorkflowStage>>(Stages.Values.Where(stage => stage.ProjectId == projectId).ToArray());
        public Task<IReadOnlyList<TaskAssignment>> ListAssignmentsAsync(Guid taskItemId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<TaskAssignment>>([]);
        public Task<TaskAssignment?> GetAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken = default) => Task.FromResult<TaskAssignment?>(null);
        public Task<IReadOnlyList<TaskDependency>> ListDependenciesAsync(Guid taskItemId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<TaskDependency>>([]);
        public Task<IReadOnlyList<TaskDependency>> ListProjectDependenciesAsync(Guid projectId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<TaskDependency>>([]);
        public Task<TaskDependency?> GetDependencyAsync(Guid dependencyId, CancellationToken cancellationToken = default) => Task.FromResult<TaskDependency?>(null);
        public Task<bool> DependencyExistsAsync(Guid predecessorTaskId, Guid successorTaskId, CancellationToken cancellationToken = default) => Task.FromResult(false);
        public Task<IReadOnlyList<Comment>> ListCommentsAsync(CommentTargetType targetType, Guid targetId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<Comment>>([]);
        public Task<Comment?> GetCommentAsync(Guid commentId, CancellationToken cancellationToken = default) => Task.FromResult<Comment?>(null);
        public Task<IReadOnlyList<ProjectTaskLabel>> ListTaskLabelsAsync(Guid projectId, bool includeArchived, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<ProjectTaskLabel>>(Labels.Values.Where(label => label.ProjectId == projectId && (includeArchived || !label.IsArchived)).ToArray());
        public Task<ProjectTaskLabel?> GetTaskLabelAsync(Guid labelId, CancellationToken cancellationToken = default) => Task.FromResult(Labels.GetValueOrDefault(labelId));
        public Task AddTaskLabelAsync(ProjectTaskLabel label, CancellationToken cancellationToken = default) { Labels[label.Id] = label; return Task.CompletedTask; }
        public Task AddWatchStateAsync(WorkItemWatchState watchState, CancellationToken cancellationToken = default) { Watches.Add(watchState); return Task.CompletedTask; }
        public Task<IReadOnlyList<WorkItemWatchState>> ListWatchStatesAsync(Guid taskItemId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<WorkItemWatchState>>(Watches.Where(watch => watch.TaskItemId == taskItemId).ToArray());
        public Task AddProjectAsync(Project project, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task AddMemberAsync(ProjectMember member, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task AddMilestoneAsync(Milestone milestone, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task AddTaskAsync(TaskItem task, CancellationToken cancellationToken = default) { Tasks[task.Id] = task; return Task.CompletedTask; }
        public Task AddAssignmentAsync(TaskAssignment assignment, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task AddDependencyAsync(TaskDependency dependency, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task AddCommentAsync(Comment comment, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public void RemoveMember(ProjectMember member) { }
        public void RemoveAssignment(TaskAssignment assignment) { }
        public void RemoveDependency(TaskDependency dependency) { }
    }

    private sealed class FakeGroups : IGroupRepository
    {
        public Task<IReadOnlyList<Group>> ListByWorkspaceAsync(Guid workspaceId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<Group>>([]);
        public Task<Group?> GetByIdAsync(Guid groupId, CancellationToken cancellationToken = default) => Task.FromResult<Group?>(null);
        public Task<GroupMember?> GetMemberAsync(Guid groupId, Guid userId, CancellationToken cancellationToken = default) => Task.FromResult<GroupMember?>(null);
        public Task<IReadOnlyList<GroupMember>> ListMembersAsync(Guid groupId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<GroupMember>>([]);
        public Task AddAsync(Group group, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task AddMemberAsync(GroupMember member, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private sealed class FakeUsers : IUserRepository
    {
        public Task<User?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) => Task.FromResult<User?>(null);
        public Task<User?> GetByNormalizedEmailAsync(string normalizedEmail, CancellationToken cancellationToken = default) => Task.FromResult<User?>(null);
        public Task AddAsync(User user, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private sealed class AllowedProjectAuthorization : IProjectAuthorizationService
    {
        public Task<bool> CanViewProject(Guid userId, Guid projectId, CancellationToken cancellationToken = default) => Task.FromResult(true);
        public Task<bool> CanManageProject(Guid userId, Guid projectId, CancellationToken cancellationToken = default) => Task.FromResult(true);
        public Task<bool> CanCreateProject(Guid userId, Guid workspaceId, Guid groupId, CancellationToken cancellationToken = default) => Task.FromResult(true);
    }

    private sealed class AllowedTaskAuthorization : ITaskAuthorizationService
    {
        public Task<bool> CanCreateTask(Guid userId, Guid projectId, CancellationToken cancellationToken = default) => Task.FromResult(true);
        public Task<bool> CanUpdateTask(Guid userId, Guid taskItemId, CancellationToken cancellationToken = default) => Task.FromResult(true);
        public Task<bool> CanAssignTask(Guid userId, Guid taskItemId, CancellationToken cancellationToken = default) => Task.FromResult(true);
        public Task<bool> CanDeleteTask(Guid userId, Guid taskItemId, CancellationToken cancellationToken = default) => Task.FromResult(true);
        public Task<bool> CanReviewTask(Guid userId, Guid taskItemId, CancellationToken cancellationToken = default) => Task.FromResult(true);
        public Task<bool> CanOverrideTaskReview(Guid userId, Guid taskItemId, CancellationToken cancellationToken = default) => Task.FromResult(true);
    }

    private sealed class FakeCurrentUser(Guid id) : ICurrentUser
    {
        public Guid? UserId => id; public Guid? SessionId => null; public string? Email => null; public SystemRole? SystemRole => null; public bool IsAuthenticated => true;
    }
    private sealed class FixedClock : IClock { public DateTimeOffset UtcNow => new(2026, 7, 25, 0, 0, 0, TimeSpan.Zero); }
    private sealed class UtcTimeZoneResolver : ITaskWorkspaceTimeZoneResolver { public Task<TimeZoneInfo> ResolveAsync(Guid tenantId, Guid workspaceId, CancellationToken cancellationToken = default) => Task.FromResult(TimeZoneInfo.Utc); }
    private sealed class FakeAudit : IAuditLogger { public List<AuditLogEntry> Entries { get; } = []; public Task LogAsync(AuditLogEntry entry, CancellationToken cancellationToken = default) { Entries.Add(entry); return Task.CompletedTask; } }
    private sealed class FakeTaskUnitOfWork : ITaskCommandUnitOfWork { public int SaveCount { get; private set; } public TaskCommandSaveResult Result { get; set; } = TaskCommandSaveResult.Saved; public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default) => Task.FromResult(1); public Task<TaskCommandSaveOutcome> SaveTaskCommandAsync(CancellationToken cancellationToken = default) { SaveCount++; return Task.FromResult<TaskCommandSaveOutcome>(Result); } }
    private sealed class FakeInvalidations : IBusinessInvalidationPublisher
    {
        public List<(Guid TaskId, string Change)> TaskChanges { get; } = [];
        public List<(Guid ProjectId, string Change)> ProjectChanges { get; } = [];
        public Task TaskChangedAsync(TaskItem task, Guid actorUserId, string change, IEnumerable<string>? changedFields = null, IEnumerable<Guid>? affectedUserIds = null, CancellationToken cancellationToken = default) { TaskChanges.Add((task.Id, change)); return Task.CompletedTask; }
        public Task ProjectChangedAsync(Project project, Guid actorUserId, string change, CancellationToken cancellationToken = default) { ProjectChanges.Add((project.Id, change)); return Task.CompletedTask; }
        public Task AnnouncementChangedAsync(Announcement announcement, Guid actorUserId, string change, IEnumerable<Guid> audienceUserIds, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task FileChangedAsync(FileObject fileObject, Attachment attachment, Guid actorUserId, string change, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
