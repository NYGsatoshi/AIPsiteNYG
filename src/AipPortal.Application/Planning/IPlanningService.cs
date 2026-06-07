using AipPortal.Application.Common;

namespace AipPortal.Application.Planning;

public interface IPlanningService
{
    Task<Result<ProjectGanttResponse>> GetGanttAsync(Guid projectId, CancellationToken cancellationToken = default);

    Task<Result<ProjectDashboardResponse>> GetDashboardAsync(Guid projectId, CancellationToken cancellationToken = default);

    Task<Result<PagedResponse<MyTaskListItemResponse>>> ListMyTasksAsync(MyTasksQuery query, CancellationToken cancellationToken = default);

    Task<Result<ProjectWorkloadResponse>> GetWorkloadAsync(Guid projectId, CancellationToken cancellationToken = default);
}
