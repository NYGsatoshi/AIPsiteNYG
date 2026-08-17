using AipPortal.Application.Common;
using AipPortal.Application.Tenancy;
using AipPortal.Web.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Web.Controllers;

[ApiController]
[Authorize]
[Route("api/tenant/capability-grants")]
public sealed class CapabilityGrantsController(ICapabilityGrantService capabilityGrants) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        var result = await capabilityGrants.ListAsync(cancellationToken);
        return result.IsSuccess
            ? Ok(ApiEnvelope.Success(HttpContext, result.Value!))
            : ToWpcError(result.ErrorDetail, result.Error, "Capability grants could not be listed.");
    }

    [HttpPost]
    public async Task<IActionResult> Grant(
        GrantCapabilityRequest request,
        CancellationToken cancellationToken)
    {
        var result = await capabilityGrants.GrantAsync(request, cancellationToken);
        return result.IsSuccess
            ? Ok(ApiEnvelope.Success(HttpContext, result.Value!))
            : ToWpcError(result.ErrorDetail, result.Error, "Capability grant update failed.");
    }

    [HttpPost("{grantId:guid}/revoke")]
    public async Task<IActionResult> Revoke(Guid grantId, CancellationToken cancellationToken)
    {
        var result = await capabilityGrants.RevokeAsync(grantId, cancellationToken);
        return result.IsSuccess
            ? Ok(ApiEnvelope.Success(HttpContext, result.Value!))
            : ToWpcError(result.ErrorDetail, result.Error, "Capability grant revocation failed.");
    }

    private IActionResult ToWpcError(
        ApplicationErrorDetail? detail,
        string? fallbackError,
        string fallbackMessage)
    {
        var sourceCode = detail?.Code ?? "ValidationFailed";
        var redactionApplied = sourceCode == "NotFound";
        var message = redactionApplied
            ? "The requested resource was not found."
            : detail?.Message ?? fallbackError ?? fallbackMessage;
        var status = sourceCode switch
        {
            "AuthenticationRequired" => StatusCodes.Status401Unauthorized,
            "CapabilityDenied" or "TenantMembershipRequired" => StatusCodes.Status403Forbidden,
            "NotFound" => StatusCodes.Status404NotFound,
            "ConcurrentModification" => StatusCodes.Status409Conflict,
            "DependencyUnavailable" => StatusCodes.Status503ServiceUnavailable,
            _ => StatusCodes.Status400BadRequest
        };
        var payload = ApiEnvelope.Error(
            HttpContext,
            status,
            redactionApplied ? "NotFound" : sourceCode,
            message,
            detail?.Target,
            redactionApplied);
        return StatusCode(status, payload);
    }
}
