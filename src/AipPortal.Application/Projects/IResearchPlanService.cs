using AipPortal.Application.Common;

namespace AipPortal.Application.Projects;

public interface IResearchPlanService
{
    Task<Result<ResearchPlanResponse>> GetAsync(Guid taskItemId, CancellationToken cancellationToken = default);
    Task<Result<ResearchPlanResponse>> ReplaceAsync(Guid taskItemId, ReplaceResearchPlanRequest request, CancellationToken cancellationToken = default);
}
