using AipPortal.Application.Audit;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Web.Controllers;

[ApiController]
[Authorize]
public sealed class AuditController(IAuditQueryService audit) : ControllerBase
{
    [HttpGet("api/audit-logs")]
    public async Task<IActionResult> AuditLogs([FromQuery] AuditLogQuery query, CancellationToken cancellationToken)
    {
        return ToActionResult(await audit.ListAuditLogsAsync(query, cancellationToken));
    }

    [HttpGet("api/security-events")]
    public async Task<IActionResult> SecurityEvents([FromQuery] SecurityEventQuery query, CancellationToken cancellationToken)
    {
        return ToActionResult(await audit.ListSecurityEventsAsync(query, cancellationToken));
    }

    private IActionResult ToActionResult<T>(AipPortal.Application.Common.Result<T> result)
    {
        return result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
    }
}
