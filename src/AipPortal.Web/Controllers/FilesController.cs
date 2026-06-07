using AipPortal.Application.Common;
using AipPortal.Application.Files;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace AipPortal.Web.Controllers;

[ApiController]
[Authorize]
public sealed class FilesController(IFileObjectService files) : ControllerBase
{
    [HttpPost("api/files")]
    [EnableRateLimiting("file-upload")]
    public async Task<IActionResult> Upload([FromForm] UploadAttachmentForm form, CancellationToken cancellationToken)
    {
        if (form.File is null)
        {
            return BadRequest(new { error = "File is required." });
        }

        await using var stream = form.File.OpenReadStream();
        return ToActionResult(await files.UploadAsync(new AttachmentUploadInput(
            form.OwnerType,
            form.OwnerId,
            form.File.FileName,
            form.File.ContentType,
            form.File.Length,
            stream), cancellationToken));
    }

    [HttpGet("api/files/{fileObjectId:guid}")]
    public async Task<IActionResult> Get(Guid fileObjectId, CancellationToken cancellationToken)
    {
        return ToActionResult(await files.GetFileObjectAsync(fileObjectId, cancellationToken));
    }

    [HttpGet("api/files/{fileObjectId:guid}/download")]
    public async Task<IActionResult> Download(Guid fileObjectId, CancellationToken cancellationToken)
    {
        var result = await files.DownloadFileObjectAsync(fileObjectId, cancellationToken);
        return result.IsSuccess
            ? File(result.Value!.Content, result.Value.ContentType, result.Value.FileName)
            : BadRequest(new { error = result.Error });
    }

    [HttpDelete("api/files/{fileObjectId:guid}")]
    public async Task<IActionResult> Delete(Guid fileObjectId, [FromQuery] string? reason, CancellationToken cancellationToken)
    {
        return OkOrBad(await files.DeleteFileObjectAsync(fileObjectId, reason, cancellationToken));
    }

    private IActionResult OkOrBad(Result result) => result.IsSuccess ? Ok(new { status = "OK" }) : BadRequest(new { error = result.Error });

    private IActionResult ToActionResult<T>(Result<T> result) => result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
}
