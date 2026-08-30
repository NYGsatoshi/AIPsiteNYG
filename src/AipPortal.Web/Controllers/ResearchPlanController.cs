using AipPortal.Application.Common;
using AipPortal.Application.Projects;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Web.Controllers;

/// <summary>
/// Task-bound Research Plan API. The server owns authorization, plan version,
/// and immutable revision history; clients only submit a proposed next plan.
/// </summary>
[ApiController]
[Authorize]
public sealed class ResearchPlanController(IResearchPlanService researchPlans) : ControllerBase
{
    [HttpGet("api/tasks/{taskItemId:guid}/research-plan")]
    public async Task<IActionResult> Get(Guid taskItemId, CancellationToken cancellationToken) =>
        ToActionResult(await researchPlans.GetAsync(taskItemId, cancellationToken));

    [HttpPut("api/tasks/{taskItemId:guid}/research-plan")]
    public async Task<IActionResult> Replace(
        Guid taskItemId,
        ReplaceResearchPlanRequest request,
        CancellationToken cancellationToken) =>
        ToActionResult(await researchPlans.ReplaceAsync(taskItemId, request, cancellationToken));

    private IActionResult ToActionResult<T>(Result<T> result)
    {
        if (result.IsSuccess)
            return Ok(result.Value);

        var detail = result.ErrorDetail;
        var code = detail?.Code ?? "RESEARCH_PLAN_REQUEST_FAILED";
        var message = detail?.Message ?? "The Research Plan request could not be completed.";
        var status = code switch
        {
            "RESEARCH_PLAN_NOT_FOUND" => StatusCodes.Status404NotFound,
            "RESEARCH_PLAN_STALE_VERSION" => StatusCodes.Status409Conflict,
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
                redactionApplied = code == "RESEARCH_PLAN_NOT_FOUND"
            }
        });
    }
}
