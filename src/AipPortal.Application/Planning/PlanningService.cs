using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Projects;

namespace AipPortal.Application.Planning;

public sealed class PlanningService(
    IPlanningRepository planning,
    IProjectAuthorizationService projectAuthorization,
    ICurrentUser currentUser,
    IClock clock) : IPlanningService
{
    public async Task<Result<ProjectGanttResponse>> GetGanttAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) || !await projectAuthorization.CanViewProject(userId, projectId, cancellationToken))
        {
            return Result<ProjectGanttResponse>.Failure("Project not found.");
        }

        var response = await planning.GetGanttAsync(projectId, Today, cancellationToken);
        return response is null
            ? Result<ProjectGanttResponse>.Failure("Project not found.")
            : Result<ProjectGanttResponse>.Success(response);
    }

    public async Task<Result<ProjectDashboardResponse>> GetDashboardAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) || !await projectAuthorization.CanViewProject(userId, projectId, cancellationToken))
        {
            return Result<ProjectDashboardResponse>.Failure("Project not found.");
        }

        var response = await planning.GetDashboardAsync(projectId, Today, cancellationToken);
        return response is null
            ? Result<ProjectDashboardResponse>.Failure("Project not found.")
            : Result<ProjectDashboardResponse>.Success(response);
    }

    public async Task<Result<MyTasksProjectionPage>> ListMyTasksAsync(MyTasksQuery query, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId))
        {
            return Failure<MyTasksProjectionPage>("MY_TASKS_AUTHENTICATION_REQUIRED", "Authentication is required.");
        }

        if (!IsValid(query))
        {
            return Failure<MyTasksProjectionPage>("MY_TASKS_INVALID_QUERY", "One or more My Tasks query values are invalid.");
        }

        var scoped = await ResolveScopeAsync(userId, query, cancellationToken);
        if (!scoped.IsSuccess)
        {
            return Failure<MyTasksProjectionPage>(scoped.ErrorCode!, scoped.ErrorMessage!);
        }

        if (query.ProjectId.HasValue && !await planning.CanViewMyTasksProjectAsync(userId, query.ProjectId.Value, cancellationToken))
        {
            return Failure<MyTasksProjectionPage>("MY_TASKS_PROJECT_NOT_FOUND", "Project not found.");
        }

        return Result<MyTasksProjectionPage>.Success(await planning.ListMyTasksAsync(userId, scoped.Query!, clock.UtcNow, cancellationToken));
    }

    public async Task<Result<MyTasksCountsResponse>> GetMyTaskCountsAsync(MyTasksQuery query, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId))
        {
            return Failure<MyTasksCountsResponse>("MY_TASKS_AUTHENTICATION_REQUIRED", "Authentication is required.");
        }

        if (!IsValid(query))
        {
            return Failure<MyTasksCountsResponse>("MY_TASKS_INVALID_QUERY", "One or more My Tasks query values are invalid.");
        }

        var scoped = await ResolveScopeAsync(userId, query, cancellationToken);
        if (!scoped.IsSuccess)
        {
            return Failure<MyTasksCountsResponse>(scoped.ErrorCode!, scoped.ErrorMessage!);
        }

        if (query.ProjectId.HasValue && !await planning.CanViewMyTasksProjectAsync(userId, query.ProjectId.Value, cancellationToken))
        {
            return Failure<MyTasksCountsResponse>("MY_TASKS_PROJECT_NOT_FOUND", "Project not found.");
        }

        return Result<MyTasksCountsResponse>.Success(await planning.GetMyTaskCountsAsync(userId, scoped.Query!, clock.UtcNow, cancellationToken));
    }

    public async Task<Result<ProjectWorkloadResponse>> GetWorkloadAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) || !await projectAuthorization.CanViewProject(userId, projectId, cancellationToken))
        {
            return Result<ProjectWorkloadResponse>.Failure("Project not found.");
        }

        var response = await planning.GetWorkloadAsync(projectId, Today, cancellationToken);
        return response is null
            ? Result<ProjectWorkloadResponse>.Failure("Project not found.")
            : Result<ProjectWorkloadResponse>.Success(response);
    }

    private DateOnly Today => DateOnly.FromDateTime(clock.UtcNow.UtcDateTime);

    private async Task<ScopeResolution> ResolveScopeAsync(Guid userId, MyTasksQuery query, CancellationToken cancellationToken)
    {
        var accessibleWorkspaceIds = await planning.ListAccessibleWorkspaceIdsAsync(userId, cancellationToken);
        if (query.Scope == MyTasksScope.AllWorkspaces)
        {
            return ScopeResolution.Success(query with { WorkspaceId = null });
        }

        if (query.WorkspaceId.HasValue)
        {
            return accessibleWorkspaceIds.Contains(query.WorkspaceId.Value)
                ? ScopeResolution.Success(query)
                : ScopeResolution.Failure(
                    "MY_TASKS_WORKSPACE_FORBIDDEN",
                    "The selected Workspace is not available.");
        }

        // There is no ambient, server-owned active-workspace value in the legacy session.
        // Selecting the sole accessible workspace is safe; multiple workspaces require the
        // client to send its explicit active Workspace selection rather than guessing.
        return accessibleWorkspaceIds.Count == 1
            ? ScopeResolution.Success(query with { WorkspaceId = accessibleWorkspaceIds[0] })
            : ScopeResolution.Failure(
                "MY_TASKS_INVALID_WORKSPACE_SCOPE",
                "An explicit active Workspace is required for the current Workspace scope.");
    }

    private static bool IsValid(MyTasksQuery query) =>
        Enum.IsDefined(query.View) &&
        Enum.IsDefined(query.Scope) &&
        (!query.StageCategory.HasValue || Enum.IsDefined(query.StageCategory.Value)) &&
        (!query.Priority.HasValue || Enum.IsDefined(query.Priority.Value)) &&
        (!query.TimeGroup.HasValue || Enum.IsDefined(query.TimeGroup.Value)) &&
        (!query.Status.HasValue || Enum.IsDefined(query.Status.Value));

    private static Result<T> Failure<T>(string code, string message) =>
        Result<T>.Failure(new ApplicationErrorDetail(code, message));

    private sealed record ScopeResolution(
        MyTasksQuery? Query,
        string? ErrorCode,
        string? ErrorMessage)
    {
        public bool IsSuccess => Query is not null;

        public static ScopeResolution Success(MyTasksQuery query) => new(query, null, null);

        public static ScopeResolution Failure(string code, string message) => new(null, code, message);
    }

    private bool TryCurrentUser(out Guid userId)
    {
        userId = currentUser.UserId ?? Guid.Empty;
        return currentUser.IsAuthenticated && currentUser.UserId.HasValue;
    }
}
