using System.Text.Json;
using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Application.Realtime;
using AipPortal.Domain.Entities;

namespace AipPortal.Tests.Realtime;

public sealed class TaskSemanticRealtimeTests
{
    [Fact]
    public void CatalogContainsOnlyApprovedTaskSemanticFamilies()
    {
        Assert.True(RealtimeEventCatalog.IsSupported("Projects.TaskAssignmentChanged.v1", 1));
        Assert.True(RealtimeEventCatalog.IsSupported("Projects.TaskWorkflowChanged.v1", 1));
        Assert.True(RealtimeEventCatalog.IsSupported("Projects.TaskCommentChanged.v1", 1));

        Assert.False(RealtimeEventCatalog.IsSupported("Projects.TaskRelationshipChanged.v1", 1));
        Assert.False(RealtimeEventCatalog.IsSupported("Projects.TaskBlockedStateChanged.v1", 1));
        Assert.False(RealtimeEventCatalog.IsSupported("Projects.TaskReviewRequested.v1", 1));
        Assert.False(RealtimeEventCatalog.IsSupported("Projects.TaskReviewResolved.v1", 1));
        Assert.False(RealtimeEventCatalog.IsSupported("Projects.TaskDeadlineChanged.v1", 1));
    }

    [Fact]
    public async Task AssignmentAndCommentPublishersEmitReferenceOnlyCanonicalPayloads()
    {
        var tenantId = Guid.NewGuid();
        var actorId = Guid.NewGuid();
        var affectedUserId = Guid.NewGuid();
        var projectId = Guid.NewGuid();
        var tenant = TenantScope(tenantId);
        var outbox = new RecordingOutbox();
        var publisher = new BusinessInvalidationPublisher(outbox, tenant, FixedClock.Instance);
        var task = new TaskItem
        {
            TenantId = tenantId,
            WorkspaceId = Guid.NewGuid(),
            ProjectId = projectId,
            Title = "restricted task title",
            Description = "restricted task description",
            ReviewReturnReason = "restricted review reason",
            VersionNo = 12
        };
        var comment = new TaskComment
        {
            TenantId = tenantId,
            WorkspaceId = task.WorkspaceId,
            ProjectId = projectId,
            TaskItemId = task.Id,
            AuthorUserId = actorId,
            BodyPlainText = "restricted comment body",
            IsImportant = true,
            VersionNo = 3
        };

        await publisher.TaskAssignmentChangedAsync(
            task,
            actorId,
            "assigneeChanged",
            [affectedUserId, affectedUserId, Guid.Empty]);
        await publisher.TaskCommentChangedAsync(task, comment, actorId, "created");

        Assert.Equal(2, outbox.Items.Count);
        var assignment = outbox.Items[0];
        Assert.Equal("Projects.TaskAssignmentChanged.v1", assignment.Envelope.EventType);
        Assert.Equal("Task", assignment.Envelope.AggregateType);
        Assert.Equal(task.Id, assignment.Envelope.AggregateId);
        Assert.Equal(task.VersionNo, assignment.Envelope.AggregateVersion);
        Assert.Equal(
            ["projectId", "taskId", "taskVersion", "change", "requiresRefetch"],
            assignment.Envelope.Payload.EnumerateObject().Select(property => property.Name).ToArray());
        Assert.Equal(2, assignment.Targets.Count);
        Assert.Contains(assignment.Targets, target =>
            target.SubscriptionType == RealtimeSubscriptionType.Project && target.ResourceId == projectId);
        Assert.Contains(assignment.Targets, target =>
            target.SubscriptionType == RealtimeSubscriptionType.User && target.ResourceId == affectedUserId);

        var commentChange = outbox.Items[1];
        Assert.Equal("Projects.TaskCommentChanged.v1", commentChange.Envelope.EventType);
        Assert.Equal(
            ["projectId", "taskId", "taskVersion", "commentId", "commentVersion", "change", "requiresRefetch"],
            commentChange.Envelope.Payload.EnumerateObject().Select(property => property.Name).ToArray());
        Assert.Equal(comment.Id, commentChange.Envelope.Payload.GetProperty("commentId").GetGuid());
        Assert.Equal(comment.VersionNo, commentChange.Envelope.Payload.GetProperty("commentVersion").GetInt64());
        var commentTarget = Assert.Single(commentChange.Targets);
        Assert.Equal(RealtimeSubscriptionType.Project, commentTarget.SubscriptionType);
        Assert.Equal(projectId, commentTarget.ResourceId);

        var storedPayload = string.Join('\n', outbox.Items.Select(item => item.Envelope.Payload.GetRawText()));
        Assert.DoesNotContain(task.Title, storedPayload, StringComparison.Ordinal);
        Assert.DoesNotContain(task.Description, storedPayload, StringComparison.Ordinal);
        Assert.DoesNotContain(task.ReviewReturnReason, storedPayload, StringComparison.Ordinal);
        Assert.DoesNotContain(comment.BodyPlainText, storedPayload, StringComparison.Ordinal);
        Assert.DoesNotContain("important", storedPayload, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("watch", storedPayload, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("recipient", storedPayload, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task TransactionalOutboxRejectsForbiddenTaskFieldsButAcceptsMinimalReferencePayload()
    {
        var tenantId = Guid.NewGuid();
        var projectId = Guid.NewGuid();
        var taskId = Guid.NewGuid();
        var tenant = TenantScope(tenantId);
        var repository = new RecordingRepository();
        var outbox = new TransactionalOutbox(repository, tenant, FixedClock.Instance);
        var target = new RealtimeRoutingTarget(RealtimeSubscriptionType.Project, projectId);

        var unsafeResult = await outbox.EnqueueAsync(
            Envelope(tenantId, taskId, JsonSerializer.SerializeToElement(new
            {
                projectId,
                taskId,
                commentBody = "must not be persisted",
                requiresRefetch = true
            })),
            [target]);

        Assert.False(unsafeResult.IsSuccess);
        Assert.Empty(repository.Items);

        var safeResult = await outbox.EnqueueAsync(
            Envelope(tenantId, taskId, JsonSerializer.SerializeToElement(new
            {
                projectId,
                taskId,
                taskVersion = 8,
                commentId = Guid.NewGuid(),
                commentVersion = 2,
                change = "updated",
                requiresRefetch = true
            })),
            [target]);

        Assert.True(safeResult.IsSuccess);
        Assert.Single(repository.Items);
    }

    private static DurableEventEnvelope Envelope(Guid tenantId, Guid taskId, JsonElement payload)
    {
        return new DurableEventEnvelope(
            Guid.NewGuid(),
            "Projects.TaskCommentChanged.v1",
            RealtimeEventCatalog.PayloadSchemaVersion1,
            FixedClock.Instance.UtcNow,
            tenantId,
            "Task",
            taskId,
            8,
            RealtimeActor.System(),
            null,
            null,
            payload);
    }

    private static CurrentTenantService TenantScope(Guid tenantId)
    {
        var tenant = new CurrentTenantService();
        tenant.SetTenant(tenantId, $"tenant-{tenantId:N}");
        return tenant;
    }

    private sealed class FixedClock : IClock
    {
        public static FixedClock Instance { get; } = new();
        public DateTimeOffset UtcNow => new(2026, 8, 2, 3, 0, 0, TimeSpan.Zero);
    }

    private sealed class RecordingOutbox : ITransactionalOutbox
    {
        public List<(DurableEventEnvelope Envelope, IReadOnlyCollection<RealtimeRoutingTarget> Targets)> Items { get; } = [];

        public Task<Result<Guid>> EnqueueAsync(
            DurableEventEnvelope envelope,
            IReadOnlyCollection<RealtimeRoutingTarget> routingTargets,
            CancellationToken cancellationToken = default)
        {
            Items.Add((envelope, routingTargets));
            return Task.FromResult(Result<Guid>.Success(envelope.EventId));
        }
    }

    private sealed class RecordingRepository : IOutboxEventRepository
    {
        public List<OutboxEvent> Items { get; } = [];

        public Task AddAsync(OutboxEvent eventItem, CancellationToken cancellationToken = default)
        {
            Items.Add(eventItem);
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<OutboxEvent>> ClaimDueAsync(string lockOwner, DateTimeOffset now, int batchSize, TimeSpan lockTimeout, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<bool> MarkDeliveredAsync(Guid eventId, Guid lockToken, DateTimeOffset deliveredAt, string? outcomeCode, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<bool> MarkFailureAsync(Guid eventId, Guid lockToken, DateTimeOffset now, bool retryable, DateTimeOffset? nextAttemptAt, string errorCode, string errorSummary, int maximumAttempts, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<bool> ReleaseAsync(Guid eventId, Guid lockToken, DateTimeOffset nextAttemptAt, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<int> RecoverStaleLocksAsync(DateTimeOffset staleBefore, DateTimeOffset now, int maximumAttempts, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<int> CleanupAsync(DateTimeOffset deliveredBefore, DateTimeOffset deadLetterBefore, DateTimeOffset cancelledBefore, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<RealtimeOutboxDiagnostics> GetDiagnosticsAsync(DateTimeOffset staleBefore, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<OutboxEvent?> GetByIdAsync(Guid eventId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<bool> ReplayAsync(Guid eventId, DateTimeOffset now, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }
}
