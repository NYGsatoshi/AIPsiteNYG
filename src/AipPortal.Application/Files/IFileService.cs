using AipPortal.Application.Common;

namespace AipPortal.Application.Files;

public interface IFileService
{
    Task<Result<AttachmentResponse>> UploadAsync(AttachmentUploadInput input, CancellationToken cancellationToken = default);

    Task<Result<AttachmentResponse>> GetAsync(Guid attachmentId, CancellationToken cancellationToken = default);

    Task<Result<FileDownloadResponse>> DownloadAsync(Guid attachmentId, CancellationToken cancellationToken = default);

    Task<Result> DeleteAsync(Guid attachmentId, CancellationToken cancellationToken = default);
}
