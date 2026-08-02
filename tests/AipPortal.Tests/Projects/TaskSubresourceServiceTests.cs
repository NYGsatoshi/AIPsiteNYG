using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Messaging;
using AipPortal.Application.Projects;
using AipPortal.Application.Realtime;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Tests.Projects;

public sealed class TaskSubresourceServiceTests
{
    [Fact]
    [Trait("Scope", "TaskV1PR07B")]
    public async Task OrdinaryCommentStagesBothInvalidationsWithoutNotificationIntent()
    {
        var fixture = new Fixture();

        var result = await fixture.Service.CreateCommentAsync(
            fixture.Task.Id,
            new CreateTaskCommentRequest("ordinary comment"));

        Assert.True(result.IsSuccess);
        Assert.Empty(fixture.Notifications.Requests);
        Assert.Single(fixture.Invalidations.CommentChanges, change => change.Change == "created");
        Assert.Single(fixture.Invalidations.TaskChanges, change => change.Change == "commentChanged");
        Assert.Equal(1, fixture.UnitOfWork.SaveCount);
    }

    [Fact]
    [Trait("Scope", "TaskV1PR07B")]
    public async Task DirectMentionAndImportantMarkerUseOneSignificantRequestWithDeduplicatedMentions()
    {
        var fixture = new Fixture();
        var mentionedUserId = fixture.AddEligibleMentionUser();
        var body = $"Please review @{{{mentionedUserId:D}}} and again @{{{mentionedUserId:D}}}.";

        var result = await fixture.Service.CreateCommentAsync(
            fixture.Task.Id,
            new CreateTaskCommentRequest(body, IsImportant: true));

        Assert.True(result.IsSuccess);
        var request = Assert.Single(fixture.Notifications.Requests);
        Assert.Equal(TaskNotificationEventKind.TaskCommentSignificant, request.EventKind);
        Assert.Equal([mentionedUserId], request.ValidDirectMentionUserIds);
        Assert.True(request.IsImportantComment);
        Assert.Equal(fixture.ActorUserId, request.ActorUserId);
        Assert.Equal(2, request.Task.VersionNo);
        Assert.Equal("created", Assert.Single(fixture.Invalidations.CommentChanges).Change);
    }

    [Fact]
    [Trait("Scope", "TaskV1PR07B")]
    public async Task UpdatedCommentRevalidatesMentionsAndUsesOneSignificantRequest()
    {
        var fixture = new Fixture();
        var mentionedUserId = fixture.AddEligibleMentionUser();
        var comment = fixture.AddComment("ordinary comment");

        var result = await fixture.Service.UpdateCommentAsync(
            comment.Id,
            new UpdateTaskCommentRequest($"Now important @{{{mentionedUserId:D}}}", true, comment.VersionNo));

        Assert.True(result.IsSuccess);
        var request = Assert.Single(fixture.Notifications.Requests);
        Assert.Equal(TaskNotificationEventKind.TaskCommentSignificant, request.EventKind);
        Assert.Equal([mentionedUserId], request.ValidDirectMentionUserIds);
        Assert.True(request.IsImportantComment);
        var semantic = Assert.Single(fixture.Invalidations.CommentChanges);
        Assert.Equal("updated", semantic.Change);
        Assert.Equal(2, semantic.CommentVersion);
        Assert.Equal(2, fixture.Task.VersionNo);
        Assert.Equal(1, fixture.UnitOfWork.SaveCount);
    }

    [Fact]
    [Trait("Scope", "TaskV1PR07B")]
    public async Task ImportanceOnlyUpdateDoesNotReplayMentionsFromThePersistedBody()
    {
        var fixture = new Fixture();
        var previouslyMentionedUserId = Guid.NewGuid();
        var comment = fixture.AddComment($"Existing @{{{previouslyMentionedUserId:D}}}");

        var result = await fixture.Service.UpdateCommentAsync(
            comment.Id,
            new UpdateTaskCommentRequest(null, true, comment.VersionNo));

        Assert.True(result.IsSuccess);
        var request = Assert.Single(fixture.Notifications.Requests);
        Assert.Equal(TaskNotificationEventKind.TaskCommentSignificant, request.EventKind);
        Assert.Empty(request.ValidDirectMentionUserIds ?? []);
        Assert.True(request.IsImportantComment);
        Assert.Equal(1, fixture.UnitOfWork.SaveCount);
    }

    [Fact]
    [Trait("Scope", "TaskV1PR07B")]
    public async Task AlreadyImportantCommentWithEmptyPatchDoesNotMutateOrNotify()
    {
        var fixture = new Fixture();
        var comment = fixture.AddComment("important", important: true);
        var before = fixture.Snapshot(comment);

        var result = await fixture.Service.UpdateCommentAsync(
            comment.Id,
            new UpdateTaskCommentRequest(null, null, comment.VersionNo));

        Assert.False(result.IsSuccess);
        Assert.Equal("TASK_COMMENT_UPDATE_REQUIRED|At least one comment field must be supplied.", result.Error);
        fixture.AssertUnchanged(comment, before);
    }

    [Fact]
    [Trait("Scope", "TaskV1PR07B")]
    public async Task AlreadyImportantCommentWithTrueAgainDoesNotMutateOrNotify()
    {
        var fixture = new Fixture();
        var comment = fixture.AddComment("important", important: true);
        var before = fixture.Snapshot(comment);

        var result = await fixture.Service.UpdateCommentAsync(
            comment.Id,
            new UpdateTaskCommentRequest(null, true, comment.VersionNo));

        Assert.True(result.IsSuccess, result.Error);
        fixture.AssertUnchanged(comment, before);
    }

    [Fact]
    [Trait("Scope", "TaskV1PR07B")]
    public async Task SameBodyPatchDoesNotMutateOrNotify()
    {
        var fixture = new Fixture();
        var comment = fixture.AddComment("same body", important: true);
        var before = fixture.Snapshot(comment);

        var result = await fixture.Service.UpdateCommentAsync(
            comment.Id,
            new UpdateTaskCommentRequest("same body", null, comment.VersionNo));

        Assert.True(result.IsSuccess, result.Error);
        fixture.AssertUnchanged(comment, before);
    }

    [Fact]
    [Trait("Scope", "TaskV1PR07B")]
    public async Task FalseToTrueImportantPatchCreatesOneSignificantIntent()
    {
        var fixture = new Fixture();
        var comment = fixture.AddComment("ordinary");

        var result = await fixture.Service.UpdateCommentAsync(
            comment.Id,
            new UpdateTaskCommentRequest(null, true, comment.VersionNo));

        Assert.True(result.IsSuccess, result.Error);
        var request = Assert.Single(fixture.Notifications.Requests);
        Assert.Equal(TaskNotificationEventKind.TaskCommentSignificant, request.EventKind);
        Assert.True(request.IsImportantComment);
        Assert.Empty(request.ValidDirectMentionUserIds ?? []);
        Assert.Equal(1, fixture.UnitOfWork.SaveCount);
    }

    [Fact]
    [Trait("Scope", "TaskV1PR07B")]
    public async Task TrueToFalseImportantPatchDoesNotNotify()
    {
        var fixture = new Fixture();
        var comment = fixture.AddComment("important", important: true);

        var result = await fixture.Service.UpdateCommentAsync(
            comment.Id,
            new UpdateTaskCommentRequest(null, false, comment.VersionNo));

        Assert.True(result.IsSuccess, result.Error);
        Assert.False(comment.IsImportant);
        Assert.Empty(fixture.Notifications.Requests);
        Assert.Equal(1, fixture.UnitOfWork.SaveCount);
    }

    [Fact]
    [Trait("Scope", "TaskV1PR07B")]
    public async Task BodyChangeOnExistingImportantWithoutMentionDoesNotNotifyImportantRecipients()
    {
        var fixture = new Fixture();
        var comment = fixture.AddComment("important", important: true);

        var result = await fixture.Service.UpdateCommentAsync(
            comment.Id,
            new UpdateTaskCommentRequest("changed body", null, comment.VersionNo));

        Assert.True(result.IsSuccess, result.Error);
        Assert.Empty(fixture.Notifications.Requests);
    }

    [Fact]
    [Trait("Scope", "TaskV1PR07B")]
    public async Task BodyChangeOnExistingImportantWithMentionNotifiesOnlyMentionTargets()
    {
        var fixture = new Fixture();
        var mentionUserId = fixture.AddEligibleMentionUser();
        var comment = fixture.AddComment("important", important: true);

        var result = await fixture.Service.UpdateCommentAsync(
            comment.Id,
            new UpdateTaskCommentRequest($"changed @{{{mentionUserId:D}}}", null, comment.VersionNo));

        Assert.True(result.IsSuccess, result.Error);
        var request = Assert.Single(fixture.Notifications.Requests);
        Assert.Equal([mentionUserId], request.ValidDirectMentionUserIds);
        Assert.False(request.IsImportantComment);
    }

    [Fact]
    [Trait("Scope", "TaskV1PR07B")]
    public async Task BodyChangeAndFalseToTrueUsesOneRecipientUnion()
    {
        var fixture = new Fixture();
        var mentionUserId = fixture.AddEligibleMentionUser();
        var comment = fixture.AddComment("ordinary");

        var result = await fixture.Service.UpdateCommentAsync(
            comment.Id,
            new UpdateTaskCommentRequest($"changed @{{{mentionUserId:D}}}", true, comment.VersionNo));

        Assert.True(result.IsSuccess, result.Error);
        var request = Assert.Single(fixture.Notifications.Requests);
        Assert.Equal(TaskNotificationEventKind.TaskCommentSignificant, request.EventKind);
        Assert.Equal([mentionUserId], request.ValidDirectMentionUserIds);
        Assert.True(request.IsImportantComment);
    }

    [Fact]
    [Trait("Scope", "TaskV1PR07B")]
    public async Task IneligibleMentionReturnsSafeErrorAndStagesNothing()
    {
        var fixture = new Fixture();
        var unavailableUserId = Guid.NewGuid();

        var result = await fixture.Service.CreateCommentAsync(
            fixture.Task.Id,
            new CreateTaskCommentRequest($"private @{{{unavailableUserId:D}}}"));

        Assert.False(result.IsSuccess);
        Assert.Equal("TASK_MENTION_NOT_ELIGIBLE|One or more mentions are not available for this task.", result.Error);
        Assert.Empty(fixture.Projects.Comments);
        Assert.Empty(fixture.Notifications.Requests);
        Assert.Empty(fixture.Invalidations.CommentChanges);
        Assert.Empty(fixture.Invalidations.TaskChanges);
        Assert.Empty(fixture.Audit.Entries);
        Assert.Equal(0, fixture.UnitOfWork.SaveCount);
        Assert.Equal(1, fixture.Task.VersionNo);
    }

    [Fact]
    [Trait("Scope", "TaskV1PR07B")]
    public async Task DeleteStagesSemanticAndGenericInvalidationsWithoutNotificationIntent()
    {
        var fixture = new Fixture();
        var comment = fixture.AddComment("delete me");

        var result = await fixture.Service.DeleteCommentAsync(comment.Id, comment.VersionNo);

        Assert.True(result.IsSuccess);
        Assert.Empty(fixture.Notifications.Requests);
        Assert.Equal("deleted", Assert.Single(fixture.Invalidations.CommentChanges).Change);
        Assert.Equal("commentChanged", Assert.Single(fixture.Invalidations.TaskChanges).Change);
        Assert.Equal(1, fixture.UnitOfWork.SaveCount);
    }

    private sealed class Fixture
    {
        public Fixture()
        {
            ActorUserId = Guid.NewGuid();
            Task = new TaskItem
            {
                TenantId = Guid.NewGuid(),
                WorkspaceId = Guid.NewGuid(),
                ProjectId = Guid.NewGuid(),
                CreatedByUserId = ActorUserId,
                Title = "Task",
                VersionNo = 1
            };
            Projects.Tasks[Task.Id] = Task;
            Service = new TaskSubresourceService(
                Projects,
                null!,
                new AllowedProjectAuthorization(),
                null!,
                new AllowedCommentAuthorization(),
                null!,
                null!,
                null!,
                new AllowingCommunicationSafetyGuard(),
                new FakeCurrentUser(ActorUserId),
                new FixedClock(),
                Audit,
                Invalidations,
                UnitOfWork,
                null!,
                Notifications);
        }

        public Guid ActorUserId { get; }
        public TaskItem Task { get; }
        public FakeProjectRepository Projects { get; } = new();
        public FakeAuditLogger Audit { get; } = new();
        public FakeInvalidationPublisher Invalidations { get; } = new();
        public FakeTaskUnitOfWork UnitOfWork { get; } = new();
        public FakeTaskNotificationProducer Notifications { get; } = new();
        public TaskSubresourceService Service { get; }

        public Guid AddEligibleMentionUser()
        {
            var emailKey = Guid.NewGuid().ToString("N");
            var user = new User
            {
                Email = $"{emailKey}@example.test",
                NormalizedEmail = $"{emailKey}@EXAMPLE.TEST".ToUpperInvariant(),
                DisplayName = "Mention target"
            };
            Projects.EligibleMentionUsers[user.Id] = user;
            return user.Id;
        }

        public TaskComment AddComment(string body, bool important = false)
        {
            var comment = new TaskComment
            {
                TenantId = Task.TenantId,
                WorkspaceId = Task.WorkspaceId,
                ProjectId = Task.ProjectId,
                TaskItemId = Task.Id,
                TaskItem = Task,
                AuthorUserId = ActorUserId,
                BodyPlainText = body,
                IsImportant = important,
                CreatedAt = new DateTimeOffset(2026, 8, 2, 0, 0, 0, TimeSpan.Zero),
                VersionNo = 1
            };
            Projects.Comments[comment.Id] = comment;
            return comment;
        }

        public CommentMutationSnapshot Snapshot(TaskComment comment) => new(
            comment.VersionNo,
            Task.VersionNo,
            comment.UpdatedAt,
            Audit.Entries.Count,
            Invalidations.TaskChanges.Count,
            Invalidations.CommentChanges.Count,
            Notifications.Requests.Count,
            UnitOfWork.SaveCount);

        public void AssertUnchanged(TaskComment comment, CommentMutationSnapshot before)
        {
            Assert.Equal(before.CommentVersion, comment.VersionNo);
            Assert.Equal(before.TaskVersion, Task.VersionNo);
            Assert.Equal(before.UpdatedAt, comment.UpdatedAt);
            Assert.Equal(before.AuditCount, Audit.Entries.Count);
            Assert.Equal(before.TaskInvalidationCount, Invalidations.TaskChanges.Count);
            Assert.Equal(before.CommentInvalidationCount, Invalidations.CommentChanges.Count);
            Assert.Equal(before.NotificationIntentCount, Notifications.Requests.Count);
            Assert.Equal(before.SaveCount, UnitOfWork.SaveCount);
        }
    }

    private sealed record CommentMutationSnapshot(
        long CommentVersion,
        long TaskVersion,
        DateTimeOffset? UpdatedAt,
        int AuditCount,
        int TaskInvalidationCount,
        int CommentInvalidationCount,
        int NotificationIntentCount,
        int SaveCount);

    private sealed class FakeProjectRepository : IProjectRepository
    {
        public Dictionary<Guid, TaskItem> Tasks { get; } = [];
        public Dictionary<Guid, TaskComment> Comments { get; } = [];
        public Dictionary<Guid, User> EligibleMentionUsers { get; } = [];

        public Task<TaskItem?> GetTaskAsync(Guid taskItemId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Tasks.GetValueOrDefault(taskItemId));

        public Task<TaskComment?> GetTaskCommentAsync(Guid commentId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Comments.GetValueOrDefault(commentId));

        public Task<IReadOnlyList<User>> GetEligibleMentionUsersAsync(Guid projectId, IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<User>>(userIds.Where(EligibleMentionUsers.ContainsKey).Select(userId => EligibleMentionUsers[userId]).ToArray());

        public Task AddTaskCommentAsync(TaskComment comment, CancellationToken cancellationToken = default)
        {
            comment.TaskItem = Tasks.GetValueOrDefault(comment.TaskItemId);
            Comments[comment.Id] = comment;
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<Project>> ListVisibleAsync(Guid userId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<Project>>([]);
        public Task<Project?> GetProjectAsync(Guid projectId, CancellationToken cancellationToken = default) => Task.FromResult<Project?>(null);
        public Task<ProjectMember?> GetMemberAsync(Guid projectId, Guid userId, CancellationToken cancellationToken = default) => Task.FromResult<ProjectMember?>(null);
        public Task<IReadOnlyList<ProjectMember>> ListMembersAsync(Guid projectId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<ProjectMember>>([]);
        public Task<IReadOnlyList<Milestone>> ListMilestonesAsync(Guid projectId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<Milestone>>([]);
        public Task<Milestone?> GetMilestoneAsync(Guid milestoneId, CancellationToken cancellationToken = default) => Task.FromResult<Milestone?>(null);
        public Task<IReadOnlyList<TaskItem>> ListTasksAsync(Guid projectId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<TaskItem>>(Tasks.Values.Where(task => task.ProjectId == projectId).ToArray());
        public Task<IReadOnlyList<TaskAssignment>> ListAssignmentsAsync(Guid taskItemId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<TaskAssignment>>([]);
        public Task<TaskAssignment?> GetAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken = default) => Task.FromResult<TaskAssignment?>(null);
        public Task<IReadOnlyList<TaskDependency>> ListDependenciesAsync(Guid taskItemId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<TaskDependency>>([]);
        public Task<IReadOnlyList<TaskDependency>> ListProjectDependenciesAsync(Guid projectId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<TaskDependency>>([]);
        public Task<TaskDependency?> GetDependencyAsync(Guid dependencyId, CancellationToken cancellationToken = default) => Task.FromResult<TaskDependency?>(null);
        public Task<bool> DependencyExistsAsync(Guid predecessorTaskId, Guid successorTaskItemId, CancellationToken cancellationToken = default) => Task.FromResult(false);
        public Task<IReadOnlyList<Comment>> ListCommentsAsync(CommentTargetType targetType, Guid targetId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<Comment>>([]);
        public Task<Comment?> GetCommentAsync(Guid commentId, CancellationToken cancellationToken = default) => Task.FromResult<Comment?>(null);
        public Task AddProjectAsync(Project project, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task AddMemberAsync(ProjectMember member, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task AddMilestoneAsync(Milestone milestone, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task AddTaskAsync(TaskItem task, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task AddAssignmentAsync(TaskAssignment assignment, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task AddDependencyAsync(TaskDependency dependency, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task AddCommentAsync(Comment comment, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public void RemoveMember(ProjectMember member) { }
        public void RemoveAssignment(TaskAssignment assignment) { }
        public void RemoveDependency(TaskDependency dependency) { }
    }

    private sealed class AllowedProjectAuthorization : IProjectAuthorizationService
    {
        public Task<bool> CanViewProject(Guid userId, Guid projectId, CancellationToken cancellationToken = default) => Task.FromResult(true);
        public Task<bool> CanManageProject(Guid userId, Guid projectId, CancellationToken cancellationToken = default) => Task.FromResult(true);
        public Task<bool> CanCreateProject(Guid userId, Guid workspaceId, Guid groupId, CancellationToken cancellationToken = default) => Task.FromResult(true);
    }

    private sealed class AllowedCommentAuthorization : ICommentAuthorizationService
    {
        public Task<bool> CanCommentOnTarget(Guid userId, CommentTargetType targetType, Guid targetId, CancellationToken cancellationToken = default) => Task.FromResult(true);
    }

    private sealed class AllowingCommunicationSafetyGuard : ICommunicationSafetyGuard
    {
        public CommunicationSafetyDecision CheckMessagePost(CommunicationSafetyScope scope, string normalizedBody, DateTimeOffset now) => CommunicationSafetyDecision.Allow();
        public CommunicationSafetyDecision CheckThreadCreate(CommunicationSafetyScope scope, DateTimeOffset now) => CommunicationSafetyDecision.Allow();
        public CommunicationSafetyDecision CheckReport(CommunicationSafetyScope scope, DateTimeOffset now) => CommunicationSafetyDecision.Allow();
    }

    private sealed class FakeCurrentUser(Guid userId) : ICurrentUser
    {
        public Guid? UserId => userId;
        public Guid? SessionId => null;
        public string? Email => null;
        public SystemRole? SystemRole => null;
        public bool IsAuthenticated => true;
    }

    private sealed class FixedClock : IClock
    {
        public DateTimeOffset UtcNow => new(2026, 8, 2, 0, 0, 0, TimeSpan.Zero);
    }

    private sealed class FakeAuditLogger : IAuditLogger
    {
        public List<AuditLogEntry> Entries { get; } = [];
        public Task LogAsync(AuditLogEntry entry, CancellationToken cancellationToken = default)
        {
            Entries.Add(entry);
            return Task.CompletedTask;
        }
    }

    private sealed class FakeInvalidationPublisher : IBusinessInvalidationPublisher
    {
        public List<(Guid TaskId, string Change)> TaskChanges { get; } = [];
        public List<(Guid TaskId, Guid CommentId, long CommentVersion, string Change)> CommentChanges { get; } = [];

        public Task TaskChangedAsync(TaskItem task, Guid actorUserId, string change, IEnumerable<string>? changedFields = null, IEnumerable<Guid>? affectedUserIds = null, CancellationToken cancellationToken = default)
        {
            TaskChanges.Add((task.Id, change));
            return Task.CompletedTask;
        }

        public Task TaskCommentChangedAsync(TaskItem task, TaskComment comment, Guid actorUserId, string change, CancellationToken cancellationToken = default)
        {
            CommentChanges.Add((task.Id, comment.Id, comment.VersionNo, change));
            return Task.CompletedTask;
        }

        public Task ProjectChangedAsync(Project project, Guid actorUserId, string change, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task AnnouncementChangedAsync(Announcement announcement, Guid actorUserId, string change, IEnumerable<Guid> audienceUserIds, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task FileChangedAsync(FileObject fileObject, Attachment attachment, Guid actorUserId, string change, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private sealed class FakeTaskNotificationProducer : ITaskNotificationProducer
    {
        public List<TaskNotificationRecipientRequest> Requests { get; } = [];
        public Task ProduceAsync(TaskNotificationRecipientRequest request, CancellationToken cancellationToken = default)
        {
            Requests.Add(request);
            return Task.CompletedTask;
        }
    }

    private sealed class FakeTaskUnitOfWork : ITaskCommandUnitOfWork
    {
        public int SaveCount { get; private set; }
        public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default) => Task.FromResult(1);
        public Task<TaskCommandSaveOutcome> SaveTaskCommandAsync(CancellationToken cancellationToken = default)
        {
            SaveCount++;
            return Task.FromResult(new TaskCommandSaveOutcome(TaskCommandSaveResult.Saved));
        }
    }
}
