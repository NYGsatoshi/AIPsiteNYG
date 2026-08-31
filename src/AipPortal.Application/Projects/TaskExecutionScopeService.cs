using System.Security.Cryptography;
using System.Text;
using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Realtime;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Projects;

/// <summary>
/// Owns the server-authoritative source-policy and durable acceptance boundary
/// for Task execution. It never resolves sources, invokes a provider, or
/// persists source content; #462 dispatches an accepted run after commit.
/// </summary>
public sealed class TaskExecutionScopeService(
    IProjectRepository projects,
    IProjectAuthorizationService projectAuthorization,
    ITaskExecutionScopeRepository executionScopes,
    IResearchPlanRepository researchPlans,
    ICurrentUser currentUser,
    IClock clock,
    IAuditLogger audit,
    IBusinessInvalidationPublisher invalidations,
    ITaskCommandUnitOfWork unitOfWork,
    ICreateIdempotencyCoordinator idempotency) : ITaskExecutionScopeService
{
    private const string RunOperation = "TaskExecution.Run.v1";

    public async Task<Result<ProjectExecutionScopeResponse>> GetProjectScopeAsync(
        Guid projectId,
        CancellationToken cancellationToken = default)
    {
        var project = await VisibleProjectAsync(projectId, cancellationToken);
        if (project is null)
            return NotFound<ProjectExecutionScopeResponse>();

        var scope = await executionScopes.GetProjectScopeAsync(project.Id, cancellationToken);
        var canManage = await CanManageAsync(project.Id, cancellationToken);
        return Result<ProjectExecutionScopeResponse>.Success(ToProjectResponse(scope, canManage));
    }

    public async Task<Result<ProjectExecutionScopeResponse>> UpdateProjectScopeAsync(
        Guid projectId,
        UpdateProjectExecutionScopeRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request.ExpectedVersion < 0)
            return Invalid<ProjectExecutionScopeResponse>("expectedVersion", "Expected version must be zero or a positive integer.");

        var project = await ManagedProjectAsync(projectId, cancellationToken);
        if (project is null)
            return NotFound<ProjectExecutionScopeResponse>();

        var actor = Actor();
        var scope = await executionScopes.GetProjectScopeForUpdateAsync(project.Id, cancellationToken);
        if (scope is null)
        {
            if (request.ExpectedVersion != 0)
                return Stale<ProjectExecutionScopeResponse>();

            scope = NewProjectScope(project, actor, request.WebEnabled, request.ProjectFilesEnabled);
            await executionScopes.AddProjectScopeAsync(scope, cancellationToken);
        }
        else
        {
            if (scope.VersionNo != request.ExpectedVersion)
                return Stale<ProjectExecutionScopeResponse>();

            scope.WebEnabled = request.WebEnabled;
            scope.ProjectFilesEnabled = request.ProjectFilesEnabled;
            scope.VersionNo = NextVersion(scope.VersionNo);
            scope.UpdatedByUserId = actor;
        }

        await audit.LogAsync(new AuditLogEntry(
            actor,
            "ProjectExecutionScopeChanged",
            "ProjectExecutionScope",
            scope.Id,
            WorkspaceId: project.WorkspaceId,
            ProjectId: project.Id,
            Metadata: ScopeMetadata(scope.WebEnabled, scope.ProjectFilesEnabled, scope.VersionNo)), cancellationToken);
        await invalidations.ProjectChangedAsync(project, actor, "executionScopeChanged", cancellationToken);

        var save = await unitOfWork.SaveTaskCommandAsync(cancellationToken);
        if (!save.IsSaved)
            return Stale<ProjectExecutionScopeResponse>();

        return Result<ProjectExecutionScopeResponse>.Success(ToProjectResponse(scope, true));
    }

    public async Task<Result<TaskExecutionScopeResponse>> GetTaskScopeAsync(
        Guid taskItemId,
        CancellationToken cancellationToken = default)
    {
        var task = await VisibleTaskAsync(taskItemId, cancellationToken);
        if (task is null)
            return NotFound<TaskExecutionScopeResponse>();

        return Result<TaskExecutionScopeResponse>.Success(
            await BuildTaskScopeResponseAsync(task, await CanManageAsync(task.ProjectId, cancellationToken), cancellationToken));
    }

    public async Task<Result<TaskExecutionScopeResponse>> UpdateTaskOverrideAsync(
        Guid taskItemId,
        UpdateTaskExecutionScopeOverrideRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request.ExpectedVersion < 0)
            return Invalid<TaskExecutionScopeResponse>("expectedVersion", "Expected version must be zero or a positive integer.");

        var task = await ManagedTaskAsync(taskItemId, cancellationToken);
        if (task is null)
            return NotFound<TaskExecutionScopeResponse>();

        var actor = Actor();
        var overrideScope = await executionScopes.GetTaskOverrideForUpdateAsync(task.Id, cancellationToken);
        if (overrideScope is null)
        {
            if (request.ExpectedVersion != 0)
                return Stale<TaskExecutionScopeResponse>();

            overrideScope = NewTaskOverride(task, actor, request.WebEnabled, request.ProjectFilesEnabled);
            await executionScopes.AddTaskOverrideAsync(overrideScope, cancellationToken);
        }
        else
        {
            if (overrideScope.VersionNo != request.ExpectedVersion)
                return Stale<TaskExecutionScopeResponse>();

            overrideScope.WebEnabled = request.WebEnabled;
            overrideScope.ProjectFilesEnabled = request.ProjectFilesEnabled;
            overrideScope.VersionNo = NextVersion(overrideScope.VersionNo);
            overrideScope.UpdatedByUserId = actor;
        }

        AdvanceTaskVersion(task);
        await audit.LogAsync(new AuditLogEntry(
            actor,
            "TaskExecutionScopeOverrideSet",
            "TaskExecutionScopeOverride",
            overrideScope.Id,
            WorkspaceId: task.WorkspaceId,
            ProjectId: task.ProjectId,
            Metadata: ScopeMetadata(overrideScope.WebEnabled, overrideScope.ProjectFilesEnabled, overrideScope.VersionNo)), cancellationToken);
        await invalidations.TaskChangedAsync(task, actor, "executionScopeChanged", cancellationToken: cancellationToken);

        var save = await unitOfWork.SaveTaskCommandAsync(cancellationToken);
        if (!save.IsSaved)
            return Stale<TaskExecutionScopeResponse>();

        return Result<TaskExecutionScopeResponse>.Success(
            await BuildTaskScopeResponseAsync(task, true, cancellationToken));
    }

    public async Task<Result<TaskExecutionScopeResponse>> ClearTaskOverrideAsync(
        Guid taskItemId,
        ClearTaskExecutionScopeOverrideRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request.ExpectedVersion < 0)
            return Invalid<TaskExecutionScopeResponse>("expectedVersion", "Expected version must be zero or a positive integer.");

        var task = await ManagedTaskAsync(taskItemId, cancellationToken);
        if (task is null)
            return NotFound<TaskExecutionScopeResponse>();

        var overrideScope = await executionScopes.GetTaskOverrideForUpdateAsync(task.Id, cancellationToken);
        if (overrideScope is null)
        {
            if (request.ExpectedVersion != 0)
                return Stale<TaskExecutionScopeResponse>();

            return Result<TaskExecutionScopeResponse>.Success(
                await BuildTaskScopeResponseAsync(task, true, cancellationToken));
        }

        if (overrideScope.VersionNo != request.ExpectedVersion)
            return Stale<TaskExecutionScopeResponse>();

        var actor = Actor();
        var removedVersion = overrideScope.VersionNo;
        executionScopes.RemoveTaskOverride(overrideScope);
        AdvanceTaskVersion(task);
        await audit.LogAsync(new AuditLogEntry(
            actor,
            "TaskExecutionScopeOverrideCleared",
            "TaskExecutionScopeOverride",
            overrideScope.Id,
            WorkspaceId: task.WorkspaceId,
            ProjectId: task.ProjectId,
            Metadata: new Dictionary<string, object?> { ["overrideVersion"] = removedVersion }), cancellationToken);
        await invalidations.TaskChangedAsync(task, actor, "executionScopeChanged", cancellationToken: cancellationToken);

        var save = await unitOfWork.SaveTaskCommandAsync(cancellationToken);
        if (!save.IsSaved)
            return Stale<TaskExecutionScopeResponse>();

        return Result<TaskExecutionScopeResponse>.Success(
            await BuildTaskScopeResponseAsync(task, true, cancellationToken));
    }

    public async Task<Result<TaskExecutionRunResponse>> RequestRunAsync(
        Guid taskItemId,
        string? idempotencyKey,
        CancellationToken cancellationToken = default)
    {
        if (!IsValidIdempotencyKey(idempotencyKey))
            return Result<TaskExecutionRunResponse>.Failure(new ApplicationErrorDetail(
                string.IsNullOrWhiteSpace(idempotencyKey) ? "TASK_EXECUTION_MISSING_IDEMPOTENCY_KEY" : "TASK_EXECUTION_INVALID_IDEMPOTENCY_KEY",
                string.IsNullOrWhiteSpace(idempotencyKey)
                    ? "An Idempotency-Key header is required."
                    : "The Idempotency-Key header is invalid.",
                Target: "header.Idempotency-Key"));

        var task = await ManagedTaskAsync(taskItemId, cancellationToken);
        if (task is null)
            return NotFound<TaskExecutionRunResponse>();

        var actor = Actor();
        // Only the generated identifier needs to exist before the idempotency
        // coordinator opens its transaction. The effective policy is read and
        // copied into this run within the staged callback below, which makes
        // the persisted snapshot's linearization point part of the accepted
        // idempotent creation transaction.
        var run = new TaskExecutionRun();

        IdempotentCreateResult<TaskExecutionRunResponse> result;
        try
        {
            result = await idempotency.ExecuteAsync(
                new CreateIdempotencyContext(
                    task.TenantId,
                    actor,
                    RunOperation,
                    idempotencyKey!,
                    CreateRunFingerprint(task),
                    "TaskExecutionRun",
                run.Id),
                async token =>
                {
                    var projectScope = await executionScopes.GetProjectScopeAsync(task.ProjectId, token);
                    var overrideScope = await executionScopes.GetTaskOverrideAsync(task.Id, token);
                    var researchPlanSnapshot = await researchPlans.GetCurrentExecutionSnapshotForTaskAsync(task.Id, token);
                    var snapshot = EffectivePolicy(projectScope, overrideScope);

                    run.TenantId = task.TenantId;
                    run.WorkspaceId = task.WorkspaceId;
                    run.ProjectId = task.ProjectId;
                    run.TaskItemId = task.Id;
                    run.RequestedByUserId = actor;
                    run.RequestedAtUtc = clock.UtcNow;
                    run.SnapshotSchemaVersion = TaskExecutionRun.CurrentSnapshotSchemaVersion;
                    run.SnapshotScopeOrigin = snapshot.Origin;
                    run.SnapshotProjectScopeVersion = snapshot.ProjectVersion;
                    run.SnapshotTaskOverrideVersion = snapshot.OverrideVersion;
                    run.SnapshotWebEnabled = snapshot.WebEnabled;
                    run.SnapshotProjectFilesEnabled = snapshot.ProjectFilesEnabled;
                    run.SnapshotResearchPlanRevisionId = researchPlanSnapshot?.RevisionId;
                    run.SnapshotResearchPlanRevisionNo = researchPlanSnapshot?.RevisionNo;
                    run.RuntimeProvider = FirstPartyProjectFilesRuntimeV1.Provider;
                    run.RuntimeContractVersion = FirstPartyProjectFilesRuntimeV1.ContractVersion;
                    run.Status = TaskExecutionRunStatus.Accepted;
                    run.FailureCode = null;
                    run.QueuedAtUtc = null;
                    run.StartedAtUtc = null;
                    run.FinishedAtUtc = null;

                    await executionScopes.AddRunAsync(run, token);

                    AdvanceTaskVersion(task);
                    await audit.LogAsync(new AuditLogEntry(
                        actor,
                        "TaskExecutionRunRequested",
                        "TaskExecutionRun",
                        run.Id,
                        WorkspaceId: task.WorkspaceId,
                        ProjectId: task.ProjectId,
                        Metadata: RunMetadata(run)), token);
                    await invalidations.TaskChangedAsync(task, actor, "executionRunChanged", cancellationToken: token);
                    return ToRunResponse(run);
                },
                async (runId, token) =>
                {
                    var existing = await executionScopes.GetRunAsync(runId, token);
                    return existing is null ? null : ToRunResponse(existing);
                },
                cancellationToken);
        }
        catch (InvalidOperationException)
        {
            return Result<TaskExecutionRunResponse>.Failure(new ApplicationErrorDetail(
                "TASK_EXECUTION_PERSISTENCE_UNAVAILABLE",
                "The execution request could not be recorded."));
        }

        return result.Disposition switch
        {
            IdempotentCreateDisposition.Created or IdempotentCreateDisposition.Replayed when result.Value is not null =>
                Result<TaskExecutionRunResponse>.Success(result.Value),
            IdempotentCreateDisposition.RequestMismatch => Result<TaskExecutionRunResponse>.Failure(new ApplicationErrorDetail(
                "TASK_EXECUTION_IDEMPOTENCY_CONFLICT",
                "The Idempotency-Key was already used for a different execution request.",
                Target: "header.Idempotency-Key")),
            _ => Result<TaskExecutionRunResponse>.Failure(new ApplicationErrorDetail(
                "TASK_EXECUTION_REPLAY_UNAVAILABLE",
                "The execution request could not be reconciled. Retry with a new Idempotency-Key."))
        };
    }

    private async Task<TaskExecutionScopeResponse> BuildTaskScopeResponseAsync(
        TaskItem task,
        bool canManage,
        CancellationToken cancellationToken)
    {
        var projectScope = await executionScopes.GetProjectScopeAsync(task.ProjectId, cancellationToken);
        var overrideScope = await executionScopes.GetTaskOverrideAsync(task.Id, cancellationToken);
        var latestRun = await executionScopes.GetLatestRunAsync(task.Id, cancellationToken);
        var effective = EffectivePolicy(projectScope, overrideScope);

        return new TaskExecutionScopeResponse(
            new TaskExecutionSourcePolicyResponse(effective.WebEnabled, effective.ProjectFilesEnabled),
            effective.Origin,
            effective.ProjectVersion,
            overrideScope?.VersionNo,
            overrideScope is null
                ? null
                : new TaskExecutionSourcePolicyResponse(overrideScope.WebEnabled, overrideScope.ProjectFilesEnabled),
            canManage,
            latestRun is null ? null : ToRunResponse(latestRun),
            "nextRun");
    }

    private async Task<Project?> VisibleProjectAsync(Guid projectId, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actor) || projectId == Guid.Empty ||
            !await projectAuthorization.CanViewProject(actor, projectId, cancellationToken))
            return null;

        var project = await projects.GetProjectAsync(projectId, cancellationToken);
        return project is { DeletedAt: null } ? project : null;
    }

    private async Task<Project?> ManagedProjectAsync(Guid projectId, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actor) || projectId == Guid.Empty ||
            !await projectAuthorization.CanManageProject(actor, projectId, cancellationToken))
            return null;

        var project = await projects.GetProjectAsync(projectId, cancellationToken);
        return project is { DeletedAt: null } ? project : null;
    }

    private async Task<TaskItem?> VisibleTaskAsync(Guid taskItemId, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actor) || taskItemId == Guid.Empty)
            return null;

        var task = await projects.GetTaskAsync(taskItemId, cancellationToken);
        return task is { DeletedAt: null } &&
               await projectAuthorization.CanViewProject(actor, task.ProjectId, cancellationToken)
            ? task
            : null;
    }

    private async Task<TaskItem?> ManagedTaskAsync(Guid taskItemId, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actor) || taskItemId == Guid.Empty)
            return null;

        var task = await projects.GetTaskAsync(taskItemId, cancellationToken);
        return task is { DeletedAt: null } &&
               await projectAuthorization.CanManageProject(actor, task.ProjectId, cancellationToken)
            ? task
            : null;
    }

    private async Task<bool> CanManageAsync(Guid projectId, CancellationToken cancellationToken) =>
        TryActor(out var actor) && await projectAuthorization.CanManageProject(actor, projectId, cancellationToken);

    private bool TryActor(out Guid actor)
    {
        actor = currentUser.UserId ?? Guid.Empty;
        return currentUser.IsAuthenticated && actor != Guid.Empty;
    }

    private Guid Actor() => currentUser.UserId ?? Guid.Empty;

    private static ProjectExecutionScope NewProjectScope(
        Project project,
        Guid actor,
        bool webEnabled,
        bool projectFilesEnabled) => new()
    {
        TenantId = project.TenantId,
        WorkspaceId = project.WorkspaceId,
        ProjectId = project.Id,
        WebEnabled = webEnabled,
        ProjectFilesEnabled = projectFilesEnabled,
        UpdatedByUserId = actor
    };

    private static TaskExecutionScopeOverride NewTaskOverride(
        TaskItem task,
        Guid actor,
        bool webEnabled,
        bool projectFilesEnabled) => new()
    {
        TenantId = task.TenantId,
        WorkspaceId = task.WorkspaceId,
        ProjectId = task.ProjectId,
        TaskItemId = task.Id,
        WebEnabled = webEnabled,
        ProjectFilesEnabled = projectFilesEnabled,
        UpdatedByUserId = actor
    };

    private static ProjectExecutionScopeResponse ToProjectResponse(ProjectExecutionScope? scope, bool canManage) =>
        new(
            new TaskExecutionSourcePolicyResponse(scope?.WebEnabled ?? false, scope?.ProjectFilesEnabled ?? false),
            scope?.VersionNo ?? 0,
            canManage);

    private static TaskExecutionRunResponse ToRunResponse(TaskExecutionRun run) => new(
        run.Id,
        run.Status,
        run.FailureCode,
        run.RequestedAtUtc,
        run.FinishedAtUtc,
        run.SnapshotSchemaVersion,
        run.SnapshotScopeOrigin,
        run.SnapshotProjectScopeVersion,
        run.SnapshotTaskOverrideVersion,
        run.SnapshotWebEnabled,
        run.SnapshotProjectFilesEnabled,
        run.RuntimeProvider,
        run.RuntimeContractVersion,
        run.QueuedAtUtc,
        run.StartedAtUtc,
        run.SnapshotResearchPlanRevisionId,
        run.SnapshotResearchPlanRevisionNo);

    private static EffectiveExecutionScope EffectivePolicy(
        ProjectExecutionScope? projectScope,
        TaskExecutionScopeOverride? taskOverride) =>
        taskOverride is null
            ? new EffectiveExecutionScope(
                TaskExecutionScopeOrigin.ProjectDefault,
                projectScope?.VersionNo ?? 0,
                null,
                projectScope?.WebEnabled ?? false,
                projectScope?.ProjectFilesEnabled ?? false)
            : new EffectiveExecutionScope(
                TaskExecutionScopeOrigin.TaskOverride,
                projectScope?.VersionNo ?? 0,
                taskOverride.VersionNo,
                taskOverride.WebEnabled,
                taskOverride.ProjectFilesEnabled);

    private static IReadOnlyDictionary<string, object?> ScopeMetadata(bool webEnabled, bool projectFilesEnabled, long version) =>
        new Dictionary<string, object?>
        {
            ["webEnabled"] = webEnabled,
            ["projectFilesEnabled"] = projectFilesEnabled,
            ["scopeVersion"] = version
        };

    private static IReadOnlyDictionary<string, object?> RunMetadata(TaskExecutionRun run) =>
        new Dictionary<string, object?>
        {
            ["snapshotSchemaVersion"] = run.SnapshotSchemaVersion,
            ["scopeOrigin"] = run.SnapshotScopeOrigin.ToString(),
            ["projectScopeVersion"] = run.SnapshotProjectScopeVersion,
            ["taskOverrideVersion"] = run.SnapshotTaskOverrideVersion,
            ["webEnabled"] = run.SnapshotWebEnabled,
            ["projectFilesEnabled"] = run.SnapshotProjectFilesEnabled,
            ["researchPlanRevisionNo"] = run.SnapshotResearchPlanRevisionNo,
            ["runtimeProvider"] = run.RuntimeProvider.ToString(),
            ["runtimeContractVersion"] = run.RuntimeContractVersion,
            ["status"] = run.Status.ToString()
        };

    private static string CreateRunFingerprint(TaskItem task)
    {
        // The request body deliberately has no source-policy fields. A retry
        // with the same key must replay the originally persisted immutable
        // snapshot even if a Project manager changes policy before the client
        // receives its response. Tenant, actor, and operation are already
        // independent parts of the idempotency context.
        return Convert.ToHexStringLower(
            SHA256.HashData(Encoding.UTF8.GetBytes(task.Id.ToString("N"))));
    }

    private static bool IsValidIdempotencyKey(string? value) =>
        value is { Length: >= 8 and <= 128 } &&
        !string.IsNullOrWhiteSpace(value) &&
        value.All(character => character is >= ' ' and <= '~');

    private static long NextVersion(long value) => Math.Max(1L, checked(value + 1L));

    private static void AdvanceTaskVersion(TaskItem task) => task.VersionNo = NextVersion(task.VersionNo);

    private static Result<T> Invalid<T>(string target, string message) =>
        Result<T>.Failure(new ApplicationErrorDetail("TASK_EXECUTION_VALIDATION_FAILED", message, Target: target));

    private static Result<T> Stale<T>() =>
        Result<T>.Failure(new ApplicationErrorDetail(
            "TASK_EXECUTION_STALE_VERSION",
            "The execution scope has changed. Refetch and retry."));

    private static Result<T> NotFound<T>() =>
        Result<T>.Failure(new ApplicationErrorDetail(
            "TASK_EXECUTION_NOT_FOUND",
            "The requested resource was not found."));

    private sealed record EffectiveExecutionScope(
        TaskExecutionScopeOrigin Origin,
        long ProjectVersion,
        long? OverrideVersion,
        bool WebEnabled,
        bool ProjectFilesEnabled);
}
