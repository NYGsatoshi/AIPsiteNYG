using AipPortal.Application.Common;
using AipPortal.Application.TenantAdministration;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Web.Controllers;

[ApiController]
[Authorize]
public sealed class TenantAdministrationController(ITenantAdministrationService tenantAdministration) : ControllerBase
{
    [HttpGet("api/tenant/settings")]
    public async Task<IActionResult> GetSettings(CancellationToken cancellationToken)
    {
        return ToActionResult(await tenantAdministration.GetCurrentTenantSettingsAsync(cancellationToken));
    }

    [HttpPatch("api/tenant/settings")]
    public async Task<IActionResult> UpdateSettings(UpdateTenantSettingsRequest request, CancellationToken cancellationToken)
    {
        return ToActionResult(await tenantAdministration.UpdateCurrentTenantSettingsAsync(request, cancellationToken));
    }

    [HttpGet("api/tenant/features")]
    public async Task<IActionResult> GetFeatures(CancellationToken cancellationToken)
    {
        return ToActionResult(await tenantAdministration.GetCurrentTenantFeaturesAsync(cancellationToken));
    }

    [HttpGet("api/tenant/usage")]
    public async Task<IActionResult> GetUsage(CancellationToken cancellationToken)
    {
        return ToActionResult(await tenantAdministration.GetCurrentTenantUsageAsync(cancellationToken));
    }

    [HttpGet("api/platform/plans")]
    [Authorize(Roles = "PlatformAdmin,SystemAdmin")]
    public async Task<IActionResult> ListPlans(CancellationToken cancellationToken)
    {
        return ToActionResult(await tenantAdministration.ListPlansAsync(cancellationToken));
    }

    [HttpPost("api/platform/plans")]
    [Authorize(Roles = "PlatformAdmin,SystemAdmin")]
    public async Task<IActionResult> CreatePlan(UpsertPlanRequest request, CancellationToken cancellationToken)
    {
        return ToActionResult(await tenantAdministration.CreatePlanAsync(request, cancellationToken));
    }

    [HttpPatch("api/platform/plans/{planId:guid}")]
    [Authorize(Roles = "PlatformAdmin,SystemAdmin")]
    public async Task<IActionResult> UpdatePlan(Guid planId, UpsertPlanRequest request, CancellationToken cancellationToken)
    {
        return ToActionResult(await tenantAdministration.UpdatePlanAsync(planId, request, cancellationToken));
    }

    [HttpDelete("api/platform/plans/{planId:guid}")]
    [Authorize(Roles = "PlatformAdmin,SystemAdmin")]
    public async Task<IActionResult> ArchivePlan(Guid planId, CancellationToken cancellationToken)
    {
        return OkOrBad(await tenantAdministration.ArchivePlanAsync(planId, cancellationToken));
    }

    [HttpGet("api/platform/tenants/{tenantId:guid}/subscription")]
    [Authorize(Roles = "PlatformAdmin,SystemAdmin")]
    public async Task<IActionResult> GetSubscription(Guid tenantId, CancellationToken cancellationToken)
    {
        return ToActionResult(await tenantAdministration.GetTenantSubscriptionAsync(tenantId, cancellationToken));
    }

    [HttpPatch("api/platform/tenants/{tenantId:guid}/subscription")]
    [Authorize(Roles = "PlatformAdmin,SystemAdmin")]
    public async Task<IActionResult> UpdateSubscription(Guid tenantId, UpdateSubscriptionRequest request, CancellationToken cancellationToken)
    {
        return ToActionResult(await tenantAdministration.UpdateTenantSubscriptionAsync(tenantId, request, cancellationToken));
    }

    [HttpGet("api/platform/tenants/{tenantId:guid}/usage")]
    [Authorize(Roles = "PlatformAdmin,SystemAdmin")]
    public async Task<IActionResult> GetPlatformUsage(Guid tenantId, CancellationToken cancellationToken)
    {
        return ToActionResult(await tenantAdministration.GetPlatformTenantUsageAsync(tenantId, cancellationToken));
    }

    private IActionResult OkOrBad(Result result) => result.IsSuccess ? Ok(new { status = "OK" }) : BadRequest(new { error = result.Error });

    private IActionResult ToActionResult<T>(Result<T> result) => result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
}
