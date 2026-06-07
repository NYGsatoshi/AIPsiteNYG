using AipPortal.Application.Common;

namespace AipPortal.Application.Files;

public interface IFileObjectService
{
    Task<Result<AttachmentResponse>> UploadAsync(AttachmentUploadInput input, CancellationToken cancellationToken = default);

    Task<Result<FileObjectResponse>> GetFileObjectAsync(Guid fileObjectId, CancellationToken cancellationToken = default);

    Task<Result<FileDownloadResponse>> DownloadFileObjectAsync(Guid fileObjectId, CancellationToken cancellationToken = default);

    Task<Result> DeleteFileObjectAsync(Guid fileObjectId, string? reason = null, CancellationToken cancellationToken = default);
}
