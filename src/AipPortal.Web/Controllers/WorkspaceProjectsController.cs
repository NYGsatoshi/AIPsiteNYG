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
public sealed class WorkspaceProjectsController(ICanonicalProjectCreateService projectCreate) : ControllerBase
{
    [HttpPost("api/workspaces/{workspaceId:guid}/projects")]
    public async Task<IActionResult> Create(
        Guid workspaceId,
        CanonicalCreateProjectRequest request,
        [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey,
        CancellationToken cancellationToken)
    {
        var result = await projectCreate.CreateAsync(workspaceId, request, idempotencyKey, cancellationToken);
        if (result.IsSuccess)
        {
            var value = result.Value!;
            return Created(
                $"/api/projects/{value.Id}",
                ApiEnvelope.Success(
                    HttpContext,
                    CanonicalRedactionProjection.Apply(
                        HttpContext,
                        value,
                        RedactionProfile.UiDetail,
                        "ProjectCreate")));
        }

        return ToWpcError(result.ErrorDetail, result.Error, "Project creation failed.");
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
            "IdempotencyConflict" or "ConcurrentModification" or "InvalidStateTransition" => StatusCodes.Status409Conflict,
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
}
