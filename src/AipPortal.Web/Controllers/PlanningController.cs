using AipPortal.Application.Planning;
using AipPortal.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Web.Controllers;

[ApiController]
[Authorize]
public sealed class PlanningController(IPlanningService planning) : ControllerBase
{
    [HttpGet("api/projects/{projectId:guid}/gantt")]
    public async Task<IActionResult> Gantt(Guid projectId, CancellationToken cancellationToken) => ToActionResult(await planning.GetGanttAsync(projectId, cancellationToken));

    [HttpGet("api/projects/{projectId:guid}/dashboard")]
    public async Task<IActionResult> Dashboard(Guid projectId, CancellationToken cancellationToken) => ToActionResult(await planning.GetDashboardAsync(projectId, cancellationToken));

    [HttpGet("api/me/tasks")]
    public async Task<IActionResult> MyTasks(
        [FromQuery] MyTasksQuery query,
        CancellationToken cancellationToken = default)
    {
        return ToActionResult(await planning.ListMyTasksAsync(query, cancellationToken));
    }

    [HttpGet("api/me/tasks/counts")]
    public async Task<IActionResult> MyTaskCounts([FromQuery] MyTasksQuery query, CancellationToken cancellationToken = default) =>
        ToActionResult(await planning.GetMyTaskCountsAsync(query, cancellationToken));

    [HttpGet("api/projects/{projectId:guid}/workload")]
    public async Task<IActionResult> Workload(Guid projectId, CancellationToken cancellationToken) => ToActionResult(await planning.GetWorkloadAsync(projectId, cancellationToken));

    private IActionResult ToActionResult<T>(AipPortal.Application.Common.Result<T> result) => result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
}
