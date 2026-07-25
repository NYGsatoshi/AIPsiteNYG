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

    private sealed class Fixture
    {
        private Fixture()
        {
            Actor = Guid.NewGuid();
            Project = new Project { WorkspaceId = Guid.NewGuid(), Name = "Project", Slug = "project", OwnerUserId = Actor, CreatedByUserId = Actor };
            Projects.ProjectItems[Project.Id] = Project;
            Service = new TaskCommandService(Projects, new FakeGroups(), Users, new AllowedProjectAuthorization(), new AllowedTaskAuthorization(), new FakeCurrentUser(Actor), new FixedClock(), Audit, Invalidations, UnitOfWork, new UtcTimeZoneResolver());
        }

        public Guid Actor { get; }
        public Project Project { get; }
        public FakeProjects Projects { get; } = new();
        public FakeUsers Users { get; } = new();
        public FakeAudit Audit { get; } = new();
        public FakeInvalidations Invalidations { get; } = new();
        public FakeTaskUnitOfWork UnitOfWork { get; } = new();
        public TaskCommandService Service { get; }
        public static Fixture Create() => new();
        public TaskItem AddTask(string title, Guid? parentId = null, int progress = 0)
        {
            var item = new TaskItem { ProjectId = Project.Id, WorkspaceId = Project.WorkspaceId, CreatedByUserId = Actor, Title = title, ParentTaskItemId = parentId, ProgressPercent = progress, VersionNo = 1 };
            Projects.Tasks[item.Id] = item;
            return item;
        }
    }

    private sealed class FakeProjects : IProjectRepository
    {
        public Dictionary<Guid, Project> ProjectItems { get; } = [];
        public Dictionary<Guid, TaskItem> Tasks { get; } = [];
        public Dictionary<Guid, TaskWorkflowStage> Stages { get; } = [];
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
    private sealed class FakeTaskUnitOfWork : ITaskCommandUnitOfWork { public int SaveCount { get; private set; } public TaskCommandSaveResult Result { get; set; } = TaskCommandSaveResult.Saved; public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default) => Task.FromResult(1); public Task<TaskCommandSaveResult> SaveTaskCommandAsync(CancellationToken cancellationToken = default) { SaveCount++; return Task.FromResult(Result); } }
    private sealed class FakeInvalidations : IBusinessInvalidationPublisher
    {
        public List<(Guid TaskId, string Change)> TaskChanges { get; } = [];
        public Task TaskChangedAsync(TaskItem task, Guid actorUserId, string change, IEnumerable<string>? changedFields = null, IEnumerable<Guid>? affectedUserIds = null, CancellationToken cancellationToken = default) { TaskChanges.Add((task.Id, change)); return Task.CompletedTask; }
        public Task ProjectChangedAsync(Project project, Guid actorUserId, string change, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task AnnouncementChangedAsync(Announcement announcement, Guid actorUserId, string change, IEnumerable<Guid> audienceUserIds, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task FileChangedAsync(FileObject fileObject, Attachment attachment, Guid actorUserId, string change, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
