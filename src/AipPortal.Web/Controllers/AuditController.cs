using AipPortal.Application.Audit;
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
        return ToActionResult(await audit.ListAuditLogsAsync(query, cancellationToken));
    }

    [HttpGet("api/tenant/audit-logs")]
    public async Task<IActionResult> TenantAuditLogs([FromQuery] AuditLogQuery query, CancellationToken cancellationToken)
    {
        return ToActionResult(await audit.ListAuditLogsAsync(query, cancellationToken));
    }

    [HttpGet("api/platform/audit-logs")]
    [Authorize(Roles = "PlatformAdmin,SystemAdmin")]
    public async Task<IActionResult> PlatformAuditLogs([FromQuery] AuditLogQuery query, CancellationToken cancellationToken)
    {
        return ToActionResult(await audit.ListAuditLogsAsync(query, cancellationToken));
    }

    [HttpGet("api/admin/audit-grid")]
    public async Task<IActionResult> AdminAuditGrid([FromQuery] AuditLogQuery query, CancellationToken cancellationToken)
    {
        // The admin grid paginates client-side and offers 50/100 rows per page.
        // Load its complete supported window when the caller omits PageSize.
        var effectiveQuery = Request.Query.ContainsKey(nameof(AuditLogQuery.PageSize))
            ? query
            : query with { PageSize = AdminAuditGridDefaultPageSize };

        return ToActionResult(await audit.ListAuditGridAsync(effectiveQuery, cancellationToken));
    }

    [HttpGet("api/security-events")]
    public async Task<IActionResult> SecurityEvents([FromQuery] SecurityEventQuery query, CancellationToken cancellationToken)
    {
        return ToActionResult(await audit.ListSecurityEventsAsync(query, cancellationToken));
    }

    [HttpGet("api/tenant/security-events")]
    public async Task<IActionResult> TenantSecurityEvents([FromQuery] SecurityEventQuery query, CancellationToken cancellationToken)
    {
        return ToActionResult(await audit.ListSecurityEventsAsync(query, cancellationToken));
    }

    [HttpGet("api/platform/security-events")]
    [Authorize(Roles = "PlatformAdmin,SystemAdmin")]
    public async Task<IActionResult> PlatformSecurityEvents([FromQuery] SecurityEventQuery query, CancellationToken cancellationToken)
    {
        return ToActionResult(await audit.ListSecurityEventsAsync(query, cancellationToken));
    }

    private IActionResult ToActionResult<T>(AipPortal.Application.Common.Result<T> result)
    {
        return result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
    }
}
