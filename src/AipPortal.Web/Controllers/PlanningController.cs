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
        [FromQuery] TaskItemStatus? status,
        [FromQuery] DateOnly? dueBefore,
        [FromQuery] Guid? projectId,
        [FromQuery] bool onlyOverdue,
        CancellationToken cancellationToken)
    {
        return ToActionResult(await planning.ListMyTasksAsync(new MyTasksQuery(status, dueBefore, projectId, onlyOverdue), cancellationToken));
    }

    [HttpGet("api/projects/{projectId:guid}/workload")]
    public async Task<IActionResult> Workload(Guid projectId, CancellationToken cancellationToken) => ToActionResult(await planning.GetWorkloadAsync(projectId, cancellationToken));

    private IActionResult ToActionResult<T>(AipPortal.Application.Common.Result<T> result) => result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
}
