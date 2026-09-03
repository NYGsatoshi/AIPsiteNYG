using AipPortal.Application.Artifacts;
using AipPortal.Web.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Web.Controllers;
[ApiController, Authorize]
public sealed class ArtifactReportsController(IArtifactReportService reports) : ControllerBase
{
    [HttpGet("api/projects/{projectId:guid}/artifact-versions/{artifactVersionId:guid}/report")]
    public async Task<IActionResult> Get(Guid projectId, Guid artifactVersionId, [FromQuery] Guid? taskId, CancellationToken ct) => Response(await reports.GetAsync(projectId,artifactVersionId,taskId,ct));
    [HttpPost("api/artifact-versions/{artifactVersionId:guid}/report")]
    public async Task<IActionResult> Attach(Guid artifactVersionId, AttachArtifactReportRequest request, CancellationToken ct) => Response(await reports.AttachAsync(artifactVersionId,request,ct));
    private IActionResult Response<T>(AipPortal.Application.Common.Result<T> result)
    {
        if(result.IsSuccess) return Ok(result.Value);
        var status=result.ErrorDetail?.Code switch { "ReportNotFound"=>404, "ReportAlreadyAttached"=>409, "AuthenticationRequired"=>401, _=>400 };
        return StatusCode(status,CanonicalErrorEnvelope.FromSensitiveResult(HttpContext,status,result.ErrorDetail,result.Error,"ArtifactReportFailed"));
    }
}
