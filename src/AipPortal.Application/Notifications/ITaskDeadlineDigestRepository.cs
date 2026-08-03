using AipPortal.Domain.Enums;

namespace AipPortal.Application.Notifications;

public sealed record TaskDeadlineDigestScheduleCandidate(
    Guid WorkspaceId,
    Guid UserId,
    string? WorkspaceTimeZoneId,
    TimeOnly EffectiveLocalTime);

public sealed record TaskDeadlineDigestScheduleWrite(
    Guid JobId,
    Guid WorkspaceId,
    Guid UserId,
    DateOnly LocalDate,
    int PolicyVersion,
    DateTimeOffset ScheduledForUtc);

public sealed record TaskDeadlineDigestClaim(
    Guid JobId,
    Guid TenantId,
    Guid WorkspaceId,
    Guid UserId,
    DateOnly LocalDate,
    int PolicyVersion,
    Guid ClaimToken,
    TaskDeadlineDigestAttemptTrigger Trigger);

public sealed record TaskDeadlineDigestCurrentContext(
    Guid TenantId,
    Guid WorkspaceId,
    Guid UserId,
    string? WorkspaceTimeZoneId,
    string? TenantTimeZoneId,
    TimeOnly EffectiveLocalTime);

public sealed record TaskDeadlineDigestCandidate(Guid TaskId, DateTimeOffset DeadlineAt);

public sealed record TaskDeadlineDigestTransition(bool Changed, bool Terminal);

public sealed record TaskDeadlineDigestStoreDiagnostics(
    long DueCount,
    long ClaimedCount,
    long SucceededCount,
    long FailedCount,
    DateTimeOffset? OldestDueAt,
    DateTimeOffset? OldestClaimedAt);

public enum TaskDeadlineDigestRestartOutcome
{
    Restarted = 0,
    NotFound = 1,
    NotFailed = 2,
    ActiveAttemptExists = 3
}

public interface ITaskDeadlineDigestTransaction : IAsyncDisposable
{
    Task CommitAsync(CancellationToken cancellationToken = default);
}

public interface ITaskDeadlineDigestRepository
{
    Task<IReadOnlyList<Guid>> ListActiveTenantIdsAsync(
        int page,
        int pageSize,
        CancellationToken cancellationToken = default);

    Task<string?> GetTenantTimeZoneIdAsync(
        Guid tenantId,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<TaskDeadlineDigestScheduleCandidate>> ListScheduleCandidatesAsync(
        int page,
        int pageSize,
        CancellationToken cancellationToken = default);

    Task<int> UpsertSchedulesAsync(
        IReadOnlyCollection<TaskDeadlineDigestScheduleWrite> schedules,
        DateTimeOffset now,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<TaskDeadlineDigestClaim>> ClaimDueAsync(
        string claimOwner,
        DateTimeOffset now,
        int batchSize,
        TimeSpan claimTimeout,
        CancellationToken cancellationToken = default);

    Task<TaskDeadlineDigestClaim?> GetClaimedAsync(
        Guid jobId,
        Guid claimToken,
        bool forUpdate,
        CancellationToken cancellationToken = default);

    Task<TaskDeadlineDigestCurrentContext?> GetCurrentContextAsync(
        Guid jobId,
        Guid claimToken,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<TaskDeadlineDigestCandidate>> ListCurrentCandidatesAsync(
        Guid jobId,
        Guid claimToken,
        DateTimeOffset deadlineBeforeUtc,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default);

    Task<ITaskDeadlineDigestTransaction> BeginGenerationTransactionAsync(
        CancellationToken cancellationToken = default);

    Task LockNotificationRecipientAsync(
        Guid userId,
        CancellationToken cancellationToken = default);

    Task<bool> MarkSucceededAsync(
        Guid jobId,
        Guid claimToken,
        Guid? notificationId,
        DateTimeOffset completedAt,
        CancellationToken cancellationToken = default);

    Task<bool> DeferAsync(
        Guid jobId,
        Guid claimToken,
        DateTimeOffset scheduledForUtc,
        DateTimeOffset deferredAt,
        CancellationToken cancellationToken = default);

    Task<TaskDeadlineDigestTransition> MarkFailureAsync(
        Guid jobId,
        Guid claimToken,
        string errorCode,
        DateTimeOffset failedAt,
        DateTimeOffset nextAttemptAt,
        CancellationToken cancellationToken = default);

    Task<TaskDeadlineDigestRestartOutcome> RestartFailedAsync(
        Guid jobId,
        Guid actorUserId,
        string reason,
        DateTimeOffset requestedAt,
        CancellationToken cancellationToken = default);

    Task<TaskDeadlineDigestStoreDiagnostics> GetDiagnosticsAsync(
        DateTimeOffset now,
        CancellationToken cancellationToken = default);

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
