using AipPortal.Application.Audit;
using AipPortal.Application.Common;
using AipPortal.Application.Security.Redaction;
using AipPortal.Web.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Web.Controllers;

[ApiController]
[Authorize]
public sealed class AuditController(
    IAuditQueryService audit,
    IAuditAuthorizationService auditAuthorization) : ControllerBase
{
    private const int AdminAuditGridDefaultPageSize = 100;

    [HttpGet("api/audit/capabilities")]
    public async Task<IActionResult> Capabilities(CancellationToken cancellationToken)
    {
        return Ok(await auditAuthorization.GetCapabilitiesAsync(cancellationToken));
    }

    [HttpGet("api/audit-logs")]
    public async Task<IActionResult> AuditLogs([FromQuery] AuditLogQuery query, CancellationToken cancellationToken)
    {
        return ToActionResult(await audit.ListAuditLogsAsync(query, cancellationToken), "AuditLogs");
    }

    [HttpGet("api/tenant/audit-logs")]
    public async Task<IActionResult> TenantAuditLogs([FromQuery] AuditLogQuery query, CancellationToken cancellationToken)
    {
        return ToActionResult(await audit.ListAuditLogsAsync(query, cancellationToken), "AuditLogs");
    }

    [HttpGet("api/platform/audit-logs")]
    [Authorize(Roles = "PlatformAdmin,SystemAdmin")]
    public async Task<IActionResult> PlatformAuditLogs([FromQuery] AuditLogQuery query, CancellationToken cancellationToken)
    {
        return ToActionResult(await audit.ListAuditLogsAsync(query, cancellationToken), "AuditLogs");
    }

    [HttpGet("api/admin/audit-grid")]
    public async Task<IActionResult> AdminAuditGrid([FromQuery] AuditLogQuery query, CancellationToken cancellationToken)
    {
        var effectiveQuery = Request.Query.ContainsKey(nameof(AuditLogQuery.PageSize))
            ? query
            : query with { PageSize = AdminAuditGridDefaultPageSize };

        return ToActionResult(await audit.ListAuditGridAsync(effectiveQuery, cancellationToken), "AuditGrid");
    }

    [HttpGet("api/security-events")]
    public async Task<IActionResult> SecurityEvents([FromQuery] SecurityEventQuery query, CancellationToken cancellationToken)
    {
        return ToActionResult(await audit.ListSecurityEventsAsync(query, cancellationToken), "SecurityEvents");
    }

    [HttpGet("api/tenant/security-events")]
    public async Task<IActionResult> TenantSecurityEvents([FromQuery] SecurityEventQuery query, CancellationToken cancellationToken)
    {
        return ToActionResult(await audit.ListSecurityEventsAsync(query, cancellationToken), "SecurityEvents");
    }

    [HttpGet("api/platform/security-events")]
    [Authorize(Roles = "PlatformAdmin,SystemAdmin")]
    public async Task<IActionResult> PlatformSecurityEvents([FromQuery] SecurityEventQuery query, CancellationToken cancellationToken)
    {
        return ToActionResult(await audit.ListSecurityEventsAsync(query, cancellationToken), "SecurityEvents");
    }

    private IActionResult ToActionResult<T>(Result<T> result, string moduleKey)
    {
        if (result.IsSuccess)
        {
            return Ok(CanonicalRedactionProjection.Apply(
                HttpContext,
                result.Value!,
                RedactionProfile.AuditDisplay,
                moduleKey,
                RedactionAuthorizationState.Allowed,
                RedactionPurpose.SecurityAuditLite));
        }

        var status = result.ErrorDetail?.Code switch
        {
            "AuthenticationRequired" => StatusCodes.Status401Unauthorized,
            "CapabilityDenied" or "TenantMembershipRequired" => StatusCodes.Status403Forbidden,
            _ => StatusCodes.Status400BadRequest
        };

        return StatusCode(status, CanonicalErrorEnvelope.FromSensitiveResult(
            HttpContext,
            status,
            result.ErrorDetail,
            result.Error,
            "AuditQueryFailed"));
    }
}
