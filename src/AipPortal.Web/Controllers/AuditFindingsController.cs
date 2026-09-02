using AipPortal.Application.Audit;
using AipPortal.Web.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Web.Controllers;

[ApiController]
[Authorize]
public sealed class AuditFindingsController(IAuditFindingsService findings) : ControllerBase
{
    [HttpGet("api/admin/audit/findings")]
    public async Task<IActionResult> List(
        [FromQuery] Guid artifactVersionId,
        [FromQuery] string? status,
        [FromQuery] string? severity,
        [FromQuery] bool openOnly,
        [FromQuery] string? workflowStatus,
        [FromQuery] bool myReviews,
        [FromQuery] bool overdue,
        [FromQuery] bool unassigned,
        CancellationToken cancellationToken)
    {
        var result = await findings.ListAsync(
            new AuditFindingsQuery(
                artifactVersionId,
                status,
                severity,
                openOnly,
                workflowStatus,
                myReviews,
                overdue,
                unassigned),
            cancellationToken);
        if (result.IsSuccess)
        {
            return Ok(result.Value);
        }

        return Error(result.ErrorDetail, result.Error, "AuditFindingsListFailed");
    }

    [HttpPatch("api/admin/audit/findings/{findingId:guid}/triage")]
    public async Task<IActionResult> UpdateTriage(
        Guid findingId,
        [FromBody] UpdateAuditFindingTriageRequest request,
        CancellationToken cancellationToken)
    {
        var result = await findings.UpdateTriageAsync(findingId, request, cancellationToken);
        if (result.IsSuccess)
        {
            return NoContent();
        }

        return Error(result.ErrorDetail, result.Error, "AuditFindingTriageFailed");
    }

    [HttpPatch("api/admin/audit/findings/{findingId:guid}/workflow")]
    public async Task<IActionResult> UpdateWorkflow(
        Guid findingId,
        [FromBody] UpdateAuditFindingWorkflowRequest request,
        CancellationToken cancellationToken)
    {
        var result = await findings.UpdateWorkflowAsync(findingId, request, cancellationToken);
        if (result.IsSuccess)
        {
            return NoContent();
        }

        return Error(result.ErrorDetail, result.Error, "AuditFindingWorkflowFailed");
    }

    private IActionResult Error(
        AipPortal.Application.Common.ApplicationErrorDetail? detail,
        string? fallback,
        string canonicalCode)
    {
        var status = detail?.Code switch
        {
            "AuthenticationRequired" => StatusCodes.Status401Unauthorized,
            "CapabilityDenied" or "TenantMembershipRequired" => StatusCodes.Status403Forbidden,
            "ArtifactVersionNotFound" or "FindingNotFound" => StatusCodes.Status404NotFound,
            "ReasonRequired" or "ValidationFailed" or "OwnerNotEligible" => StatusCodes.Status400BadRequest,
            _ => StatusCodes.Status400BadRequest
        };

        return StatusCode(status, CanonicalErrorEnvelope.FromSensitiveResult(
            HttpContext,
            status,
            detail,
            fallback,
            canonicalCode));
    }
}
