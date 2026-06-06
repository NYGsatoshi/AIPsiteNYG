using AipPortal.Domain.Enums;

namespace AipPortal.Application.Files;

public sealed record AttachmentUploadInput(
    AttachmentOwnerType OwnerType,
    Guid OwnerId,
    string OriginalFileName,
    string ContentType,
    long Length,
    Stream Content);

public sealed record AttachmentResponse(
    Guid Id,
    AttachmentOwnerType? OwnerType,
    Guid? OwnerId,
    string OriginalFileName,
    string StoredFileName,
    string FilePath,
    string ContentType,
    long FileSize,
    Guid UploadedByUserId,
    DateTimeOffset CreatedAt,
    DateTimeOffset? DeletedAt);

public sealed record FileDownloadResponse(Stream Content, string FileName, string ContentType, long SizeBytes);
