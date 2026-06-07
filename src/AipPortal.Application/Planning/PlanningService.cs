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

    public async Task<Result<PagedResponse<MyTaskListItemResponse>>> ListMyTasksAsync(MyTasksQuery query, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId))
        {
            return Result<PagedResponse<MyTaskListItemResponse>>.Failure("Authentication is required.");
        }

        if (query.ProjectId.HasValue && !await projectAuthorization.CanViewProject(userId, query.ProjectId.Value, cancellationToken))
        {
            return Result<PagedResponse<MyTaskListItemResponse>>.Failure("Project not found.");
        }

        return Result<PagedResponse<MyTaskListItemResponse>>.Success(await planning.ListMyTasksAsync(userId, query, Today, cancellationToken));
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

    private bool TryCurrentUser(out Guid userId)
    {
        userId = currentUser.UserId ?? Guid.Empty;
        return currentUser.IsAuthenticated && currentUser.UserId.HasValue;
    }
}
