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
            return Result<MyTasksProjectionPage>.Failure("Authentication is required.");
        }

        if (query.ProjectId.HasValue && !await projectAuthorization.CanViewProject(userId, query.ProjectId.Value, cancellationToken))
        {
            return Result<MyTasksProjectionPage>.Failure("Project not found.");
        }

        var scoped = await ResolveScopeAsync(userId, query, cancellationToken);
        if (scoped is null)
        {
            return Result<MyTasksProjectionPage>.Failure("An authorized active workspace is required for the current Workspace scope.");
        }

        return Result<MyTasksProjectionPage>.Success(await planning.ListMyTasksAsync(userId, scoped, clock.UtcNow, cancellationToken));
    }

    public async Task<Result<MyTasksCountsResponse>> GetMyTaskCountsAsync(MyTasksQuery query, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId))
        {
            return Result<MyTasksCountsResponse>.Failure("Authentication is required.");
        }

        if (query.ProjectId.HasValue && !await projectAuthorization.CanViewProject(userId, query.ProjectId.Value, cancellationToken))
        {
            return Result<MyTasksCountsResponse>.Failure("Project not found.");
        }

        var scoped = await ResolveScopeAsync(userId, query, cancellationToken);
        if (scoped is null)
        {
            return Result<MyTasksCountsResponse>.Failure("An authorized active workspace is required for the current Workspace scope.");
        }

        return Result<MyTasksCountsResponse>.Success(await planning.GetMyTaskCountsAsync(userId, scoped, clock.UtcNow, cancellationToken));
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

    private async Task<MyTasksQuery?> ResolveScopeAsync(Guid userId, MyTasksQuery query, CancellationToken cancellationToken)
    {
        var accessibleWorkspaceIds = await planning.ListAccessibleWorkspaceIdsAsync(userId, cancellationToken);
        if (query.Scope == MyTasksScope.AllWorkspaces)
        {
            return query with { WorkspaceId = null };
        }

        if (query.WorkspaceId.HasValue)
        {
            return accessibleWorkspaceIds.Contains(query.WorkspaceId.Value) ? query : null;
        }

        // There is no ambient, server-owned active-workspace value in the legacy session.
        // Selecting the sole accessible workspace is safe; multiple workspaces require the
        // client to send its explicit active Workspace selection rather than guessing.
        return accessibleWorkspaceIds.Count == 1
            ? query with { WorkspaceId = accessibleWorkspaceIds[0] }
            : null;
    }

    private bool TryCurrentUser(out Guid userId)
    {
        userId = currentUser.UserId ?? Guid.Empty;
        return currentUser.IsAuthenticated && currentUser.UserId.HasValue;
    }
}
