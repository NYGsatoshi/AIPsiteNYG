using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Files;

public sealed class FileService(
    IFileRepository files,
    IFileStorageService storage,
    IFileAuthorizationService authorization,
    ICurrentUser currentUser,
    IClock clock,
    IAuditLogger auditLogger,
    IUnitOfWork unitOfWork) : IFileService
{
    public async Task<Result<AttachmentResponse>> UploadAsync(AttachmentUploadInput input, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) ||
            !await authorization.CanUploadAttachment(userId, input.OwnerType, input.OwnerId, cancellationToken))
        {
            return Result<AttachmentResponse>.Failure("You are not allowed to upload an attachment for this resource.");
        }

        var owner = await files.ResolveOwnerAsync(input.OwnerType, input.OwnerId, cancellationToken);
        if (owner is null)
        {
            return Result<AttachmentResponse>.Failure("Attachment owner not found.");
        }

        var saved = await storage.SaveAsync(input.OriginalFileName, input.ContentType, input.Length, input.Content, cancellationToken);
        if (!saved.IsSuccess)
        {
            return Result<AttachmentResponse>.Failure(saved.Error!);
        }

        var attachment = new Attachment
        {
            WorkspaceId = owner.WorkspaceId,
            OwnerType = input.OwnerType,
            OwnerId = input.OwnerId,
            OwnerUserId = owner.AuthorUserId ?? userId,
            UploadedByUserId = userId,
            FileName = Path.GetFileName(input.OriginalFileName),
            StoredFileName = saved.Value!.StoredFileName,
            FilePath = saved.Value.FilePath,
            ContentType = saved.Value.ContentType,
            Extension = saved.Value.Extension,
            SizeBytes = saved.Value.SizeBytes,
            StorageProvider = "Local",
            StorageKey = saved.Value.StorageKey,
            ScanStatus = FileScanStatus.Skipped
        };

        await files.AddAttachmentAsync(attachment, cancellationToken);
        await auditLogger.LogAsync(new AuditLogEntry(userId, "AttachmentUploaded", "Attachment", attachment.Id), cancellationToken);
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

        var content = await storage.OpenReadAsync(attachment.StorageKey, cancellationToken);
        await auditLogger.LogAsync(new AuditLogEntry(userId, "AttachmentDownloaded", "Attachment", attachment.Id), cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<FileDownloadResponse>.Success(new FileDownloadResponse(content, attachment.FileName, attachment.ContentType, attachment.SizeBytes));
    }

    public async Task<Result> DeleteAsync(Guid attachmentId, CancellationToken cancellationToken = default)
    {
        var attachment = await files.GetAttachmentAsync(attachmentId, cancellationToken);
        if (attachment is null || !TryCurrentUser(out var userId) ||
            !await authorization.CanDeleteAttachment(userId, attachment, cancellationToken))
        {
            return Result.Failure("Attachment not found.");
        }

        attachment.MarkDeleted(clock.UtcNow);
        await auditLogger.LogAsync(new AuditLogEntry(userId, "AttachmentDeleted", "Attachment", attachment.Id), cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
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
            attachment.OwnerType,
            attachment.OwnerId,
            attachment.FileName,
            attachment.StoredFileName,
            attachment.FilePath,
            attachment.ContentType,
            attachment.SizeBytes,
            attachment.UploadedByUserId,
            attachment.CreatedAt,
            attachment.DeletedAt);
    }
}
