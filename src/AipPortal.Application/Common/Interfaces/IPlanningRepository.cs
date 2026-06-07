using AipPortal.Application.Planning;

namespace AipPortal.Application.Common.Interfaces;

public interface IPlanningRepository
{
    Task<ProjectGanttResponse?> GetGanttAsync(Guid projectId, DateOnly today, CancellationToken cancellationToken = default);

    Task<ProjectDashboardResponse?> GetDashboardAsync(Guid projectId, DateOnly today, CancellationToken cancellationToken = default);

    Task<PagedResponse<MyTaskListItemResponse>> ListMyTasksAsync(Guid userId, MyTasksQuery query, DateOnly today, CancellationToken cancellationToken = default);

    Task<ProjectWorkloadResponse?> GetWorkloadAsync(Guid projectId, DateOnly today, CancellationToken cancellationToken = default);
}
