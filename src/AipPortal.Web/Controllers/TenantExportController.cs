using AipPortal.Application.TenantExports;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Web.Controllers;

[ApiController]
[Authorize]
public sealed class TenantExportController(ITenantExportService tenantExports) : ControllerBase
{
    [HttpPost("api/tenant/export")]
    public async Task<IActionResult> Export(TenantExportRequest request, CancellationToken cancellationToken)
    {
        var result = await tenantExports.ExportAsync(request, cancellationToken);
        if (!result.IsSuccess)
        {
            return BadRequest(new { error = result.Error });
        }

        var file = result.Value!;
        Response.Headers["X-Export-Job-Id"] = file.ExportJobId.ToString();
        return File(file.Content, file.ContentType, file.FileName);
    }

    [HttpGet("api/tenant/export/{exportJobId:guid}")]
    public async Task<IActionResult> GetJob(Guid exportJobId, CancellationToken cancellationToken)
    {
        var result = await tenantExports.GetJobAsync(exportJobId, cancellationToken);
        return result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
    }
}
