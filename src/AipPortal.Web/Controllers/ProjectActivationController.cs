using AipPortal.Application.Common;
using AipPortal.Application.Projects;
using AipPortal.Application.Security.Redaction;
using AipPortal.Web.Models;
using AipPortal.Web.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Web.Controllers;

[ApiController]
[Authorize]
public sealed class ProjectActivationController(IProjectActivationService activation) : ControllerBase
{
    [HttpPost("api/projects/{projectId:guid}/activate")]
    public async Task<IActionResult> Activate(
        Guid projectId,
        ActivateProjectRequest request,
        CancellationToken cancellationToken)
    {
        var result = await activation.ActivateAsync(
            projectId,
            request.ExpectedVersion,
            cancellationToken);

        if (result.IsSuccess)
        {
            return Ok(ApiEnvelope.Success(
                HttpContext,
                CanonicalRedactionProjection.Apply(
                    HttpContext,
                    new ProjectActivationCommandResponse(projectId),
                    RedactionProfile.UiDetail,
                    "ProjectActivation")));
        }

        return ToWpcError(result.ErrorDetail, result.Error, "Project activation failed.");
    }

    private IActionResult ToWpcError(
        ApplicationErrorDetail? detail,
        string? fallbackError,
        string fallbackMessage)
    {
        var sourceCode = detail?.Code ?? "ValidationFailed";
        var sensitive = sourceCode == "NotFound";
        var code = sensitive ? "NotFound" : sourceCode;
        var message = sensitive
            ? "The requested resource was not found."
            : detail?.Message ?? fallbackError ?? fallbackMessage;
        var status = sourceCode switch
        {
            "AuthenticationRequired" => StatusCodes.Status401Unauthorized,
            "CapabilityDenied" or "TenantMembershipRequired" => StatusCodes.Status403Forbidden,
            "NotFound" => StatusCodes.Status404NotFound,
            "ConcurrentModification" or "InvalidStateTransition" or
            "InvalidTaskWorkflow" or "InvalidProjectGeneral" => StatusCodes.Status409Conflict,
            "DependencyUnavailable" => StatusCodes.Status503ServiceUnavailable,
            _ => StatusCodes.Status400BadRequest
        };
        var payload = ApiEnvelope.Error(
            HttpContext,
            status,
            code,
            message,
            detail?.Target,
            sensitive);

        return status switch
        {
            StatusCodes.Status401Unauthorized => Unauthorized(payload),
            StatusCodes.Status404NotFound => NotFound(payload),
            StatusCodes.Status409Conflict => Conflict(payload),
            StatusCodes.Status400BadRequest => BadRequest(payload),
            _ => StatusCode(status, payload)
        };
    }

    private sealed record ProjectActivationCommandResponse(Guid ProjectId);
}
