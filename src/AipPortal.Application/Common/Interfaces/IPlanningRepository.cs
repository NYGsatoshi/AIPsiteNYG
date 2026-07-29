using AipPortal.Application.Planning;

namespace AipPortal.Application.Common.Interfaces;

public interface IPlanningRepository
{
    Task<ProjectGanttResponse?> GetGanttAsync(Guid projectId, DateOnly today, CancellationToken cancellationToken = default);

    Task<ProjectDashboardResponse?> GetDashboardAsync(Guid projectId, DateOnly today, CancellationToken cancellationToken = default);

    Task<MyTasksProjectionPage> ListMyTasksAsync(Guid userId, MyTasksQuery query, DateTimeOffset now, CancellationToken cancellationToken = default);

    Task<MyTasksCountsResponse> GetMyTaskCountsAsync(Guid userId, MyTasksQuery query, DateTimeOffset now, CancellationToken cancellationToken = default);

    Task<bool> CanViewMyTasksProjectAsync(Guid userId, Guid projectId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<Guid>> ListAccessibleWorkspaceIdsAsync(Guid userId, CancellationToken cancellationToken = default);

    Task<ProjectWorkloadResponse?> GetWorkloadAsync(Guid projectId, DateOnly today, CancellationToken cancellationToken = default);
}
