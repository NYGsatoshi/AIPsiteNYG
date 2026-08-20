using AipPortal.Application.Common;
using AipPortal.Application.Files;
using AipPortal.Application.Security.Redaction;
using AipPortal.Web.Models;
using AipPortal.Web.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace AipPortal.Web.Controllers;

[ApiController]
[Authorize]
public sealed class FilesController(IFileObjectService files) : ControllerBase
{
    [HttpGet("api/files")]
    public async Task<IActionResult> List(
        [FromQuery] Guid workspaceId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken cancellationToken = default)
    {
        return ToFileMetadataActionResult(
            await files.ListFileObjectsAsync(workspaceId, page, pageSize, cancellationToken),
            "FileList");
    }

    [HttpPost("api/files")]
    [EnableRateLimiting("file-upload")]
    public async Task<IActionResult> Upload([FromForm] UploadAttachmentForm form, CancellationToken cancellationToken)
    {
        if (form.File is null)
        {
            return BadRequest(ApiEnvelope.Error(
                HttpContext,
                StatusCodes.Status400BadRequest,
                "ValidationFailed",
                "File is required.",
                "file"));
        }

        await using var stream = form.File.OpenReadStream();
        return ToFileMetadataActionResult(await files.UploadAsync(new AttachmentUploadInput(
            form.OwnerType,
            form.OwnerId,
            form.File.FileName,
            form.File.ContentType,
            form.File.Length,
            stream), cancellationToken),
            "FileUpload");
    }

    [HttpGet("api/files/{fileObjectId:guid}")]
    public async Task<IActionResult> Get(Guid fileObjectId, CancellationToken cancellationToken)
    {
        return ToFileMetadataActionResult(
            await files.GetFileObjectAsync(fileObjectId, cancellationToken),
            "FileRead");
    }

    [HttpGet("api/files/{fileObjectId:guid}/download")]
    public async Task<IActionResult> Download(Guid fileObjectId, CancellationToken cancellationToken)
    {
        var result = await files.DownloadFileObjectAsync(fileObjectId, cancellationToken);
        return result.IsSuccess
            ? PrivateFile(result.Value!.Content, result.Value.ContentType, result.Value.FileName)
            : BadRequest(CanonicalErrorEnvelope.FromSensitiveResult(
                HttpContext,
                StatusCodes.Status400BadRequest,
                result.ErrorDetail,
                result.Error,
                "FileDownloadFailed"));
    }

    [HttpPost("api/files/{fileObjectId:guid}/download-grants")]
    public async Task<IActionResult> CreateDownloadGrant(
        Guid fileObjectId,
        [FromBody] FileDownloadGrantRequest? request,
        CancellationToken cancellationToken)
    {
        return ToActionResult(await files.RequestFileObjectDownloadGrantAsync(
            fileObjectId,
            request ?? new FileDownloadGrantRequest(),
            cancellationToken));
    }

    [HttpPost("api/file-download-grants/{fileDownloadGrantId:guid}/download")]
    public async Task<IActionResult> DownloadWithGrant(
        Guid fileDownloadGrantId,
        [FromBody] FileDownloadGrantTokenRequest request,
        CancellationToken cancellationToken)
    {
        var result = await files.DownloadFileObjectWithGrantAsync(fileDownloadGrantId, request.Token, cancellationToken);
        return result.IsSuccess
            ? PrivateFile(result.Value!.Content, result.Value.ContentType, result.Value.FileName)
            : BadRequest(CanonicalErrorEnvelope.FromSensitiveResult(
                HttpContext,
                StatusCodes.Status400BadRequest,
                result.ErrorDetail,
                result.Error,
                "FileDownloadFailed"));
    }

    [HttpDelete("api/files/{fileObjectId:guid}")]
    public async Task<IActionResult> Delete(Guid fileObjectId, [FromQuery] string? reason, CancellationToken cancellationToken)
    {
        return OkOrBad(await files.DeleteFileObjectAsync(fileObjectId, reason, cancellationToken));
    }

    private IActionResult OkOrBad(Result result) =>
        result.IsSuccess
            ? Ok(new { status = "OK" })
            : BadRequest(CanonicalErrorEnvelope.FromSensitiveResult(
                HttpContext,
                StatusCodes.Status400BadRequest,
                result.ErrorDetail,
                result.Error,
                "FileOperationFailed"));

    private IActionResult ToActionResult<T>(Result<T> result) =>
        result.IsSuccess
            ? Ok(result.Value)
            : BadRequest(CanonicalErrorEnvelope.FromSensitiveResult(
                HttpContext,
                StatusCodes.Status400BadRequest,
                result.ErrorDetail,
                result.Error,
                "FileGrantFailed"));

    private IActionResult ToFileMetadataActionResult<T>(
        Result<T> result,
        string moduleKey) =>
        result.IsSuccess
            ? Ok(CanonicalRedactionProjection.Apply(
                HttpContext,
                result.Value!,
                RedactionProfile.FileMetadata,
                moduleKey,
                RedactionAuthorizationState.Allowed))
            : BadRequest(CanonicalErrorEnvelope.FromSensitiveResult(
                HttpContext,
                StatusCodes.Status400BadRequest,
                result.ErrorDetail,
                result.Error,
                "FileMetadataFailed"));

    private FileStreamResult PrivateFile(Stream content, string contentType, string fileName)
    {
        Response.Headers.CacheControl = "no-store, max-age=0";
        Response.Headers.Pragma = "no-cache";
        Response.Headers.Expires = "0";
        return File(content, contentType, fileName);
    }
}
