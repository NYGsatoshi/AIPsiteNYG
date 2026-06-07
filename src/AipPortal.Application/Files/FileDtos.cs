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
    Guid FileObjectId,
    AttachmentOwnerType? OwnerType,
    Guid? OwnerId,
    string OriginalFileName,
    string StoredFileName,
    string StorageKey,
    string ContentType,
    long FileSize,
    Guid UploadedByUserId,
    DateTimeOffset CreatedAt,
    DateTimeOffset? DeletedAt);

public sealed record FileDownloadResponse(Stream Content, string FileName, string ContentType, long SizeBytes);

public sealed record FileObjectResponse(
    Guid Id,
    Guid? WorkspaceId,
    Guid? GroupId,
    Guid? ProjectId,
    string OriginalFileName,
    string StorageKey,
    string ContentType,
    long SizeBytes,
    string Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt,
    DateTimeOffset? DeletedAt);
