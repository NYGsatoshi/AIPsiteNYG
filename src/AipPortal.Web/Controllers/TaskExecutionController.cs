using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Projects;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Web.Controllers;

/// <summary>
/// Server-authoritative Task execution-policy and durable acceptance boundary.
/// It never accepts browser authority for sources and never starts a runtime
/// before the accepted run has committed.
/// </summary>
[ApiController]
[Authorize]
public sealed class TaskExecutionController(
    ITaskExecutionScopeService executionScopes,
    ITaskExecutionRuntime? runtime = null,
    ICurrentTenant? currentTenant = null) : ControllerBase
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
        if (!result.IsSuccess || result.Value is not { } accepted)
        {
            return ToActionResult(result);
        }

        var response = accepted;
        if (runtime is not null &&
            currentTenant is { IsAvailable: true, IsPlatformScope: false } &&
            currentTenant.TenantId != Guid.Empty)
        {
            // The acceptance/idempotency transaction has completed before this
            // post-commit dispatch. A disconnected browser cannot revoke that
            // durable request, so runtime completion is not tied to the HTTP
            // request cancellation token.
            await runtime.ExecuteAsync(new TaskExecutionRuntimeHandle(
                accepted.Id,
                currentTenant.TenantId,
                accepted.RuntimeContractVersion), CancellationToken.None);

            var refreshed = await executionScopes.GetTaskScopeAsync(taskItemId, CancellationToken.None);
            if (refreshed.IsSuccess &&
                refreshed.Value is { LatestRun: { } latest } &&
                latest.Id == accepted.Id)
            {
                response = latest;
            }
        }

        return StatusCode(StatusCodes.Status201Created, response);
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
