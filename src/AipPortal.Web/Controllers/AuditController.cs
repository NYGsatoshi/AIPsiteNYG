using AipPortal.Application.Audit;
using AipPortal.Application.Security.Redaction;
using AipPortal.Web.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Web.Controllers;

[ApiController]
[Authorize]
public sealed class AuditController(IAuditQueryService audit) : ControllerBase
{
    private const int AdminAuditGridDefaultPageSize = 100;

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

    private IActionResult ToActionResult<T>(
        AipPortal.Application.Common.Result<T> result,
        string moduleKey)
    {
        return result.IsSuccess
            ? Ok(CanonicalRedactionProjection.Apply(
                HttpContext,
                result.Value!,
                RedactionProfile.AuditDisplay,
                moduleKey,
                RedactionAuthorizationState.Allowed,
                RedactionPurpose.SecurityAuditLite))
            : BadRequest(CanonicalErrorEnvelope.FromSensitiveResult(
                HttpContext,
                StatusCodes.Status400BadRequest,
                result.ErrorDetail,
                result.Error,
                "AuditQueryFailed"));
    }
}
