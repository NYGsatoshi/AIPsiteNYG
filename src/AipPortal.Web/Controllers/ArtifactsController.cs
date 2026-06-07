using AipPortal.Application.Artifacts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace AipPortal.Web.Controllers;

[ApiController]
[Authorize]
public sealed class ArtifactsController(IArtifactService artifacts) : ControllerBase
{
    [HttpGet("api/projects/{projectId:guid}/artifacts")]
    public async Task<IActionResult> List(Guid projectId, CancellationToken cancellationToken) => ToActionResult(await artifacts.ListAsync(projectId, cancellationToken));

    [HttpPost("api/projects/{projectId:guid}/artifacts")]
    public async Task<IActionResult> Create(Guid projectId, CreateArtifactRequest request, CancellationToken cancellationToken) => ToActionResult(await artifacts.CreateAsync(projectId, request, cancellationToken));

    [HttpGet("api/artifacts/{artifactId:guid}")]
    public async Task<IActionResult> Get(Guid artifactId, CancellationToken cancellationToken) => ToActionResult(await artifacts.GetAsync(artifactId, cancellationToken));

    [HttpPatch("api/artifacts/{artifactId:guid}")]
    public async Task<IActionResult> Update(Guid artifactId, UpdateArtifactRequest request, CancellationToken cancellationToken) => ToActionResult(await artifacts.UpdateAsync(artifactId, request, cancellationToken));

    [HttpDelete("api/artifacts/{artifactId:guid}")]
    public async Task<IActionResult> Delete(Guid artifactId, CancellationToken cancellationToken) => OkOrBad(await artifacts.DeleteAsync(artifactId, cancellationToken));

    [HttpGet("api/artifacts/{artifactId:guid}/versions")]
    public async Task<IActionResult> ListVersions(Guid artifactId, CancellationToken cancellationToken) => ToActionResult(await artifacts.ListVersionsAsync(artifactId, cancellationToken));

    [HttpPost("api/artifacts/{artifactId:guid}/versions")]
    [EnableRateLimiting("file-upload")]
    public async Task<IActionResult> UploadVersion(Guid artifactId, [FromForm] UploadArtifactVersionForm form, CancellationToken cancellationToken)
    {
        if (form.File is null)
        {
            return BadRequest(new { error = "File is required." });
        }

        await using var stream = form.File.OpenReadStream();
        return ToActionResult(await artifacts.UploadVersionAsync(artifactId, new UploadArtifactVersionInput(
            form.File.FileName,
            form.File.ContentType,
            form.File.Length,
            stream,
            form.ChangeNote), cancellationToken));
    }

    [HttpGet("api/artifact-versions/{versionId:guid}/download")]
    public async Task<IActionResult> DownloadVersion(Guid versionId, CancellationToken cancellationToken)
    {
        var result = await artifacts.DownloadVersionAsync(versionId, cancellationToken);
        return result.IsSuccess
            ? File(result.Value!.Content, result.Value.ContentType, result.Value.FileName)
            : BadRequest(new { error = result.Error });
    }

    [HttpDelete("api/artifact-versions/{versionId:guid}")]
    public async Task<IActionResult> DeleteVersion(Guid versionId, CancellationToken cancellationToken) => OkOrBad(await artifacts.DeleteVersionAsync(versionId, cancellationToken));

    private IActionResult OkOrBad(AipPortal.Application.Common.Result result) => result.IsSuccess ? Ok(new { status = "OK" }) : BadRequest(new { error = result.Error });
    private IActionResult ToActionResult<T>(AipPortal.Application.Common.Result<T> result) => result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
}

public sealed class UploadArtifactVersionForm
{
    public IFormFile? File { get; set; }

    public string? ChangeNote { get; set; }
}
