using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Files;

public sealed class FileService(
    IFileRepository files,
    IFileStorageService storage,
    IFileAuthorizationService authorization,
    IFileUploadPolicy uploadPolicy,
    IFeatureFlagService featureFlags,
    IQuotaService quotaService,
    ICurrentUser currentUser,
    ICurrentTenant currentTenant,
    IClock clock,
    IAuditLogger auditLogger,
    IUnitOfWork unitOfWork) : IFileService
    , IFileObjectService
{
    public async Task<Result<AttachmentResponse>> UploadAsync(AttachmentUploadInput input, CancellationToken cancellationToken = default)
    {
        if (!currentTenant.IsAvailable)
        {
            return Result<AttachmentResponse>.Failure("A tenant context is required.");
        }

        var feature = await featureFlags.RequireEnabledAsync(FeatureKeys.FileSharing, cancellationToken);
        if (!feature.IsSuccess)
        {
            return Result<AttachmentResponse>.Failure(feature.Error!);
        }

        if (!TryCurrentUser(out var userId) ||
            !await authorization.CanUploadAttachment(userId, input.OwnerType, input.OwnerId, cancellationToken))
        {
            return Result<AttachmentResponse>.Failure("You are not allowed to upload an attachment for this resource.");
        }

        var validation = ValidateUpload(input);
        if (!validation.IsSuccess)
        {
            return Result<AttachmentResponse>.Failure(validation.Error!);
        }

        var quota = await quotaService.CanUploadFileAsync(currentTenant.TenantId, input.Length, cancellationToken);
        if (!quota.IsSuccess)
        {
            await auditLogger.LogAsync(new AuditLogEntry(userId, "FileUploadBlockedByQuota", "FileObject", null, quota.Error), cancellationToken);
            await unitOfWork.SaveChangesAsync(cancellationToken);
            return Result<AttachmentResponse>.Failure(quota.Error!);
        }

        var owner = await files.ResolveOwnerAsync(input.OwnerType, input.OwnerId, cancellationToken);
        if (owner is null)
        {
            return Result<AttachmentResponse>.Failure("Attachment owner not found.");
        }

        var safeFileName = SanitizeFileName(input.OriginalFileName);
        var fileObject = new FileObject
        {
            TenantId = currentTenant.TenantId,
            WorkspaceId = owner.WorkspaceId,
            ProjectId = owner.ProjectId,
            UploadedByUserId = userId,
            OriginalFileName = safeFileName,
            ContentType = NormalizeContentType(input.ContentType),
            SizeBytes = input.Length,
            Status = FileObjectStatus.Active
        };
        fileObject.StorageKey = CreateStorageKey(fileObject);

        var saved = await storage.SaveAsync(fileObject.StorageKey, input.Content, fileObject.ContentType, cancellationToken);
        if (!saved.IsSuccess)
        {
            return Result<AttachmentResponse>.Failure(saved.Error!);
        }

        await files.AddFileObjectAsync(fileObject, cancellationToken);
        var attachment = new Attachment
        {
            TenantId = currentTenant.TenantId,
            FileObjectId = fileObject.Id,
            WorkspaceId = owner.WorkspaceId,
            OwnerType = input.OwnerType,
            OwnerId = input.OwnerId,
            OwnerUserId = owner.AuthorUserId ?? userId,
            UploadedByUserId = userId,
            FileName = safeFileName,
            StoredFileName = fileObject.Id.ToString("N"),
            FilePath = fileObject.StorageKey,
            ContentType = fileObject.ContentType,
            Extension = Path.GetExtension(safeFileName).ToLowerInvariant(),
            SizeBytes = fileObject.SizeBytes,
            StorageProvider = "Configured",
            StorageKey = fileObject.StorageKey,
            ScanStatus = FileScanStatus.Skipped
        };

        await files.AddAttachmentAsync(attachment, cancellationToken);
        await auditLogger.LogAsync(new AuditLogEntry(
            userId,
            "FileUploaded",
            "FileObject",
            fileObject.Id,
            "File uploaded.",
            WorkspaceId: owner.WorkspaceId,
            ProjectId: owner.ProjectId), cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<AttachmentResponse>.Success(ToResponse(attachment));
    }

    public async Task<Result<AttachmentResponse>> GetAsync(Guid attachmentId, CancellationToken cancellationToken = default)
    {
        var attachment = await files.GetAttachmentAsync(attachmentId, cancellationToken);
        if (attachment is null || !TryCurrentUser(out var userId) ||
            !await authorization.CanViewAttachment(userId, attachment, cancellationToken))
        {
            return Result<AttachmentResponse>.Failure("Attachment not found.");
        }

        return Result<AttachmentResponse>.Success(ToResponse(attachment));
    }

    public async Task<Result<FileDownloadResponse>> DownloadAsync(Guid attachmentId, CancellationToken cancellationToken = default)
    {
        var attachment = await files.GetAttachmentAsync(attachmentId, cancellationToken);
        if (attachment is null || !TryCurrentUser(out var userId) ||
            !await authorization.CanDownloadAttachment(userId, attachment, cancellationToken))
        {
            return Result<FileDownloadResponse>.Failure("Attachment not found.");
        }

        if (attachment.FileObject?.Status != FileObjectStatus.Active || attachment.FileObject.DeletedAt.HasValue)
        {
            return Result<FileDownloadResponse>.Failure("Attachment not found.");
        }

        var content = await storage.OpenReadAsync(attachment.FileObject.StorageKey, cancellationToken);
        await auditLogger.LogAsync(new AuditLogEntry(
            userId,
            "FileDownloaded",
            "FileObject",
            attachment.FileObject.Id,
            "File downloaded.",
            WorkspaceId: attachment.WorkspaceId,
            ProjectId: attachment.FileObject.ProjectId), cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<FileDownloadResponse>.Success(new FileDownloadResponse(content, attachment.FileObject.OriginalFileName, attachment.FileObject.ContentType, attachment.FileObject.SizeBytes));
    }

    public async Task<Result> DeleteAsync(Guid attachmentId, CancellationToken cancellationToken = default)
    {
        var attachment = await files.GetAttachmentAsync(attachmentId, cancellationToken);
        if (attachment is null || !TryCurrentUser(out var userId) ||
            !await authorization.CanDeleteAttachment(userId, attachment, cancellationToken))
        {
            return Result.Failure("Attachment not found.");
        }

        return await DeleteAttachmentAsync(attachment, userId, "Attachment deleted.", cancellationToken);
    }

    public async Task<Result<FileObjectResponse>> GetFileObjectAsync(Guid fileObjectId, CancellationToken cancellationToken = default)
    {
        var attachment = await files.GetAttachmentByFileObjectAsync(fileObjectId, cancellationToken);
        if (attachment is null || attachment.FileObject is null || !TryCurrentUser(out var userId) ||
            !await authorization.CanViewAttachment(userId, attachment, cancellationToken))
        {
            return Result<FileObjectResponse>.Failure("File not found.");
        }

        if (attachment.FileObject.TenantId != currentTenant.TenantId)
        {
            return Result<FileObjectResponse>.Failure("File not found.");
        }

        return Result<FileObjectResponse>.Success(ToFileObjectResponse(attachment.FileObject));
    }

    public async Task<Result<FileDownloadResponse>> DownloadFileObjectAsync(Guid fileObjectId, CancellationToken cancellationToken = default)
    {
        var attachment = await files.GetAttachmentByFileObjectAsync(fileObjectId, cancellationToken);
        return attachment is null
            ? Result<FileDownloadResponse>.Failure("File not found.")
            : await DownloadAsync(attachment.Id, cancellationToken);
    }

    public async Task<Result> DeleteFileObjectAsync(Guid fileObjectId, string? reason = null, CancellationToken cancellationToken = default)
    {
        var attachment = await files.GetAttachmentByFileObjectAsync(fileObjectId, cancellationToken);
        if (attachment is null)
        {
            return Result.Failure("File not found.");
        }

        if (!TryCurrentUser(out var userId) || !await authorization.CanDeleteAttachment(userId, attachment, cancellationToken))
        {
            return Result.Failure("File not found.");
        }

        return await DeleteAttachmentAsync(attachment, userId, reason, cancellationToken);
    }

    private bool TryCurrentUser(out Guid userId)
    {
        userId = currentUser.UserId ?? Guid.Empty;
        return currentUser.IsAuthenticated && currentUser.UserId.HasValue;
    }

    public static AttachmentResponse ToResponse(Attachment attachment)
    {
        return new AttachmentResponse(
            attachment.Id,
            attachment.FileObjectId,
            attachment.OwnerType,
            attachment.OwnerId,
            attachment.FileObject?.OriginalFileName ?? attachment.FileName,
            attachment.StoredFileName,
            attachment.FileObject?.StorageKey ?? attachment.StorageKey,
            attachment.FileObject?.ContentType ?? attachment.ContentType,
            attachment.FileObject?.SizeBytes ?? attachment.SizeBytes,
            attachment.UploadedByUserId,
            attachment.CreatedAt,
            attachment.FileObject?.DeletedAt ?? attachment.DeletedAt);
    }

    private Result ValidateUpload(AttachmentUploadInput input)
    {
        if (input.Length <= 0)
        {
            return Result.Failure("Empty files are not allowed.");
        }

        if (input.Length > uploadPolicy.MaxFileSizeBytes)
        {
            return Result.Failure($"File exceeds the maximum size of {uploadPolicy.MaxFileSizeBytes} bytes.");
        }

        var extension = Path.GetExtension(input.OriginalFileName).ToLowerInvariant();
        var allowed = uploadPolicy.AllowedExtensions.Select(item => item.ToLowerInvariant()).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(extension) || !allowed.Contains(extension))
        {
            return Result.Failure("File extension is not allowed.");
        }

        return Result.Success();
    }

    private async Task<Result> DeleteAttachmentAsync(Attachment attachment, Guid userId, string? reason, CancellationToken cancellationToken)
    {
        attachment.MarkDeleted(clock.UtcNow);
        attachment.FileObject?.MarkDeleted(clock.UtcNow, userId, reason);
        await auditLogger.LogAsync(new AuditLogEntry(userId, "FileDeleted", "FileObject", attachment.FileObjectId, "File soft-deleted.", WorkspaceId: attachment.WorkspaceId, ProjectId: attachment.FileObject?.ProjectId), cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    private static string CreateStorageKey(FileObject fileObject)
    {
        var tenantPart = fileObject.TenantId.ToString("D");
        var filePart = fileObject.Id.ToString("D");
        return fileObject.ProjectId.HasValue
            ? $"tenants/{tenantPart}/projects/{fileObject.ProjectId.Value:D}/files/{filePart}"
            : $"tenants/{tenantPart}/files/{filePart}";
    }

    private static string SanitizeFileName(string originalFileName)
    {
        var fileName = Path.GetFileName(originalFileName);
        if (string.IsNullOrWhiteSpace(fileName))
        {
            fileName = "upload";
        }

        foreach (var invalid in Path.GetInvalidFileNameChars())
        {
            fileName = fileName.Replace(invalid, '_');
        }

        fileName = fileName.Trim();
        return fileName.Length <= 260 ? fileName : fileName[..260];
    }

    private static string NormalizeContentType(string contentType)
    {
        return string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType.Trim();
    }

    private static FileObjectResponse ToFileObjectResponse(FileObject fileObject)
    {
        return new FileObjectResponse(
            fileObject.Id,
            fileObject.WorkspaceId,
            fileObject.GroupId,
            fileObject.ProjectId,
            fileObject.OriginalFileName,
            fileObject.StorageKey,
            fileObject.ContentType,
            fileObject.SizeBytes,
            fileObject.Status.ToString(),
            fileObject.CreatedAt,
            fileObject.UpdatedAt,
            fileObject.DeletedAt);
    }
}
