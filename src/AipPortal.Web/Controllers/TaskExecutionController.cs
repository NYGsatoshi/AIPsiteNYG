using AipPortal.Application.Common;
using AipPortal.Application.Projects;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Web.Controllers;

/// <summary>
/// Server-authoritative Task execution-policy boundary. The foundation exposes
/// configuration and immutable run-policy records only; it cannot execute Web
/// retrieval or materialize source content.
/// </summary>
[ApiController]
[Authorize]
public sealed class TaskExecutionController(ITaskExecutionScopeService executionScopes) : ControllerBase
{
    [HttpGet("api/projects/{projectId:guid}/execution-scope")]
    public async Task<IActionResult> GetProjectScope(Guid projectId, CancellationToken cancellationToken) =>
        ToActionResult(await executionScopes.GetProjectScopeAsync(projectId, cancellationToken));

    [HttpPut("api/projects/{projectId:guid}/execution-scope")]
    public async Task<IActionResult> UpdateProjectScope(
        Guid projectId,
        UpdateProjectExecutionScopeRequest request,
        CancellationToken cancellationToken) =>
        ToActionResult(await executionScopes.UpdateProjectScopeAsync(projectId, request, cancellationToken));

    [HttpGet("api/tasks/{taskItemId:guid}/execution-scope")]
    public async Task<IActionResult> GetTaskScope(Guid taskItemId, CancellationToken cancellationToken) =>
        ToActionResult(await executionScopes.GetTaskScopeAsync(taskItemId, cancellationToken));

    [HttpPut("api/tasks/{taskItemId:guid}/execution-scope-override")]
    public async Task<IActionResult> UpdateTaskOverride(
        Guid taskItemId,
        UpdateTaskExecutionScopeOverrideRequest request,
        CancellationToken cancellationToken) =>
        ToActionResult(await executionScopes.UpdateTaskOverrideAsync(taskItemId, request, cancellationToken));

    [HttpDelete("api/tasks/{taskItemId:guid}/execution-scope-override")]
    public async Task<IActionResult> ClearTaskOverride(
        Guid taskItemId,
        ClearTaskExecutionScopeOverrideRequest request,
        CancellationToken cancellationToken) =>
        ToActionResult(await executionScopes.ClearTaskOverrideAsync(taskItemId, request, cancellationToken));

    [HttpPost("api/tasks/{taskItemId:guid}/execution-runs")]
    public async Task<IActionResult> RequestRun(
        Guid taskItemId,
        RequestTaskExecutionRunRequest request,
        [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey,
        CancellationToken cancellationToken)
    {
        _ = request;
        var result = await executionScopes.RequestRunAsync(taskItemId, idempotencyKey, cancellationToken);
        return result.IsSuccess
            ? StatusCode(StatusCodes.Status201Created, result.Value)
            : ToActionResult(result);
    }

    private IActionResult ToActionResult<T>(Result<T> result)
    {
        if (result.IsSuccess)
            return Ok(result.Value);

        var detail = result.ErrorDetail;
        var code = detail?.Code ?? "TASK_EXECUTION_REQUEST_FAILED";
        var message = detail?.Message ?? "The execution scope request could not be completed.";
        var status = code switch
        {
            "TASK_EXECUTION_NOT_FOUND" => StatusCodes.Status404NotFound,
            "TASK_EXECUTION_STALE_VERSION" or "TASK_EXECUTION_IDEMPOTENCY_CONFLICT" => StatusCodes.Status409Conflict,
            "TASK_EXECUTION_PERSISTENCE_UNAVAILABLE" or "TASK_EXECUTION_REPLAY_UNAVAILABLE" => StatusCodes.Status503ServiceUnavailable,
            _ => StatusCodes.Status400BadRequest
        };

        return StatusCode(status, new
        {
            requestId = HttpContext.TraceIdentifier,
            error = new
            {
                code,
                message,
                target = detail?.Target,
                details = Array.Empty<object>(),
                redactionApplied = code == "TASK_EXECUTION_NOT_FOUND"
            }
        });
    }
}
