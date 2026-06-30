using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using System.Security.Cryptography;
using System.Text;

namespace AipPortal.Application.Files;

public sealed class FileService(
    IFileRepository files,
    IFileDownloadGrantRepository downloadGrants,
    IFileStorageService storage,
    IFileAuthorizationService authorization,
    IFileUploadPolicy uploadPolicy,
    IFeatureFlagService featureFlags,
    IQuotaService quotaService,
    ICurrentUser currentUser,
    ICurrentTenant currentTenant,
    IClock clock,
    IAuditLogger auditLogger,
    ITokenHasher tokenHasher,
    IUnitOfWork unitOfWork) : IFileService
    , IFileObjectService
{
    private static readonly TimeSpan FileDownloadGrantLifetime = TimeSpan.FromMinutes(10);

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

        var safeFileName = FileNameSanitizer.SanitizeOriginalFileName(input.OriginalFileName);
        var fileObject = new FileObject
        {
            TenantId = currentTenant.TenantId,
            WorkspaceId = owner.WorkspaceId,
            ProjectId = owner.ProjectId,
            UploadedByUserId = userId,
            OriginalFileName = safeFileName,
            ContentType = NormalizeContentType(input.ContentType),
            SizeBytes = input.Length,
            Classification = DataClassification.Private,
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
        if (attachment is null || !TryCurrentUser(out var userId))
        {
            return Result<AttachmentResponse>.Failure("Attachment not found.");
        }

        if (!await authorization.CanViewAttachment(userId, attachment, cancellationToken))
        {
            await LogDeniedFileAccessAsync(userId, "AttachmentMetadataDenied", attachment, cancellationToken);
            return Result<AttachmentResponse>.Failure("Attachment not found.");
        }

        return Result<AttachmentResponse>.Success(ToResponse(attachment));
    }

    public async Task<Result<FileDownloadResponse>> DownloadAsync(Guid attachmentId, CancellationToken cancellationToken = default)
    {
        var grant = await RequestDownloadGrantAsync(attachmentId, new FileDownloadGrantRequest("direct-download"), cancellationToken);
        return grant.IsSuccess
            ? await DownloadWithGrantAsync(grant.Value!.FileDownloadGrantId, grant.Value.Token, cancellationToken)
            : Result<FileDownloadResponse>.Failure(grant.Error!);
    }

    public async Task<Result<FileDownloadGrantResponse>> RequestDownloadGrantAsync(
        Guid attachmentId,
        FileDownloadGrantRequest request,
        CancellationToken cancellationToken = default)
    {
        var attachment = await files.GetAttachmentAsync(attachmentId, cancellationToken);
        if (attachment is null || !TryCurrentUser(out var userId))
        {
            return Result<FileDownloadGrantResponse>.Failure("Attachment not found.");
        }

        var decision = await ValidateAttachmentForGrantAsync(userId, attachment, existingGrant: null, cancellationToken);
        if (!decision.IsAllowed)
        {
            await LogFileGrantDeniedAsync(userId, attachment, null, decision.AuditAction, decision.DenialReason, cancellationToken);
            return Result<FileDownloadGrantResponse>.Failure("Attachment not found.");
        }

        var token = CreateOpaqueToken();
        var grant = new FileDownloadGrant
        {
            TenantId = attachment.TenantId,
            ActorUserId = userId,
            WorkspaceId = attachment.WorkspaceId,
            FileObjectId = attachment.FileObjectId,
            AttachmentId = attachment.Id,
            TargetScopeType = attachment.OwnerType!.Value,
            TargetScopeId = attachment.OwnerId!.Value,
            Classification = attachment.FileObject!.Classification!.Value,
            AllowedOperation = "download",
            TokenHash = tokenHasher.HashToken(token),
            PolicyStamp = ComputeFilePolicyStamp(userId, attachment),
            Purpose = string.IsNullOrWhiteSpace(request.Purpose) ? null : request.Purpose.Trim(),
            ExpiresAt = clock.UtcNow.Add(FileDownloadGrantLifetime)
        };

        await downloadGrants.AddAsync(grant, cancellationToken);
        await auditLogger.LogAsync(new AuditLogEntry(
            userId,
            "file_download.grant_created",
            "FileDownloadGrant",
            grant.Id,
            "File download grant created.",
            WorkspaceId: grant.WorkspaceId,
            ProjectId: attachment.FileObject.ProjectId,
            Metadata: FileGrantAuditMetadata(grant, "allow", "created"),
            TenantId: grant.TenantId), cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);

        return Result<FileDownloadGrantResponse>.Success(ToGrantResponse(grant, token));
    }

    public async Task<Result<FileDownloadResponse>> DownloadWithGrantAsync(
        Guid fileDownloadGrantId,
        string token,
        CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) || !currentTenant.IsAvailable)
        {
            return Result<FileDownloadResponse>.Failure("Attachment not found.");
        }

        var grant = await downloadGrants.GetAsync(fileDownloadGrantId, cancellationToken);
        if (grant is null)
        {
            return Result<FileDownloadResponse>.Failure("Attachment not found.");
        }

        if (grant.TenantId != currentTenant.TenantId)
        {
            await LogFileGrantDeniedAsync(userId, null, grant, "grant.scope_mismatch", "tenant-mismatch", cancellationToken);
            return Result<FileDownloadResponse>.Failure("Attachment not found.");
        }

        if (grant.ActorUserId != userId)
        {
            await LogFileGrantDeniedAsync(userId, null, grant, "grant.actor_mismatch", "actor-mismatch", cancellationToken);
            return Result<FileDownloadResponse>.Failure("Attachment not found.");
        }

        if (string.IsNullOrWhiteSpace(token) ||
            !string.Equals(grant.TokenHash, tokenHasher.HashToken(token), StringComparison.Ordinal))
        {
            await LogFileGrantDeniedAsync(userId, null, grant, "file_download.denied", "invalid-grant-token", cancellationToken);
            return Result<FileDownloadResponse>.Failure("Attachment not found.");
        }

        var attachment = await files.GetAttachmentAsync(grant.AttachmentId, cancellationToken);
        if (attachment is null)
        {
            await LogFileGrantDeniedAsync(userId, null, grant, "grant.scope_mismatch", "attachment-missing", cancellationToken);
            return Result<FileDownloadResponse>.Failure("Attachment not found.");
        }

        var decision = await ValidateAttachmentForGrantAsync(userId, attachment, grant, cancellationToken);
        if (!decision.IsAllowed)
        {
            await LogFileGrantDeniedAsync(userId, attachment, grant, decision.AuditAction, decision.DenialReason, cancellationToken);
            return Result<FileDownloadResponse>.Failure("Attachment not found.");
        }

        var fileObject = attachment.FileObject ?? throw new InvalidOperationException("Validated attachment must include a file object.");
        var content = await storage.OpenReadAsync(fileObject.StorageKey, cancellationToken);
        grant.DownloadedAt = clock.UtcNow;
        await auditLogger.LogAsync(new AuditLogEntry(
            userId,
            "file_download.started",
            "FileDownloadGrant",
            grant.Id,
            "File download authorized.",
            WorkspaceId: attachment.WorkspaceId,
            ProjectId: fileObject.ProjectId,
            Metadata: FileGrantAuditMetadata(grant, "allow", "fresh-reauthorization"),
            TenantId: grant.TenantId), cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<FileDownloadResponse>.Success(new FileDownloadResponse(content, fileObject.OriginalFileName, fileObject.ContentType, fileObject.SizeBytes));
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
        if (attachment is null || attachment.FileObject is null || !TryCurrentUser(out var userId))
        {
            return Result<FileObjectResponse>.Failure("File not found.");
        }

        if (!await authorization.CanViewAttachment(userId, attachment, cancellationToken))
        {
            await LogDeniedFileAccessAsync(userId, "FileMetadataDenied", attachment, cancellationToken);
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

    public async Task<Result<FileDownloadGrantResponse>> RequestFileObjectDownloadGrantAsync(
        Guid fileObjectId,
        FileDownloadGrantRequest request,
        CancellationToken cancellationToken = default)
    {
        var attachment = await files.GetAttachmentByFileObjectAsync(fileObjectId, cancellationToken);
        return attachment is null
            ? Result<FileDownloadGrantResponse>.Failure("File not found.")
            : await RequestDownloadGrantAsync(attachment.Id, request, cancellationToken);
    }

    public Task<Result<FileDownloadResponse>> DownloadFileObjectWithGrantAsync(
        Guid fileDownloadGrantId,
        string token,
        CancellationToken cancellationToken = default)
    {
        return DownloadWithGrantAsync(fileDownloadGrantId, token, cancellationToken);
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

        var contentType = NormalizeContentType(input.ContentType);
        var allowedContentTypes = uploadPolicy.AllowedContentTypes
            .Select(item => item.Trim())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (!allowedContentTypes.Contains(contentType))
        {
            return Result.Failure("File content type is not allowed.");
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

    private async Task LogDeniedFileAccessAsync(Guid userId, string action, Attachment attachment, CancellationToken cancellationToken)
    {
        await auditLogger.LogAsync(new AuditLogEntry(
            userId,
            action,
            "FileObject",
            attachment.FileObjectId,
            "File access denied."), cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
    }

    private async Task<FileGrantDecision> ValidateAttachmentForGrantAsync(
        Guid userId,
        Attachment attachment,
        FileDownloadGrant? existingGrant,
        CancellationToken cancellationToken)
    {
        if (!currentTenant.IsAvailable ||
            attachment.TenantId != currentTenant.TenantId ||
            attachment.FileObject is null ||
            attachment.FileObject.TenantId != currentTenant.TenantId)
        {
            return FileGrantDecision.Deny("grant.scope_mismatch", "tenant-mismatch");
        }

        if (existingGrant is not null)
        {
            if (!string.Equals(existingGrant.AllowedOperation, "download", StringComparison.OrdinalIgnoreCase))
            {
                return FileGrantDecision.Deny("file_download.denied", "operation-mismatch");
            }

            if (clock.UtcNow >= existingGrant.ExpiresAt)
            {
                return FileGrantDecision.Deny("grant.expired", "grant-expired");
            }

            if (existingGrant.RevokedAt.HasValue)
            {
                return FileGrantDecision.Deny("grant.revoked", "grant-revoked");
            }

            if (existingGrant.TenantId != attachment.TenantId ||
                existingGrant.WorkspaceId != attachment.WorkspaceId ||
                existingGrant.FileObjectId != attachment.FileObjectId ||
                existingGrant.AttachmentId != attachment.Id ||
                existingGrant.TargetScopeType != attachment.OwnerType ||
                existingGrant.TargetScopeId != attachment.OwnerId)
            {
                return FileGrantDecision.Deny("grant.scope_mismatch", "scope-mismatch");
            }
        }

        if (attachment.DeletedAt.HasValue ||
            !attachment.OwnerType.HasValue ||
            !attachment.OwnerId.HasValue ||
            attachment.FileObject.Status != FileObjectStatus.Active ||
            attachment.FileObject.DeletedAt.HasValue ||
            attachment.ScanStatus is FileScanStatus.Pending or FileScanStatus.Infected or FileScanStatus.Failed)
        {
            return FileGrantDecision.Deny("file_download.denied", "file-inaccessible");
        }

        if (!IsAllowedClassification(attachment.FileObject.Classification))
        {
            return FileGrantDecision.Deny("file_download.denied", "classification-fail-closed");
        }

        var classification = attachment.FileObject.Classification;
        if (existingGrant is not null &&
            (!classification.HasValue || existingGrant.Classification != classification.Value))
        {
            return FileGrantDecision.Deny("grant.scope_mismatch", "classification-mismatch");
        }

        if (!await authorization.CanDownloadAttachment(userId, attachment, cancellationToken))
        {
            return FileGrantDecision.Deny("file_download.denied", "current-authorization-failed");
        }

        if (existingGrant is not null &&
            !string.Equals(existingGrant.PolicyStamp, ComputeFilePolicyStamp(userId, attachment), StringComparison.Ordinal))
        {
            return FileGrantDecision.Deny("grant.stale_policy", "stale-policy");
        }

        return FileGrantDecision.Allow();
    }

    private async Task LogFileGrantDeniedAsync(
        Guid userId,
        Attachment? attachment,
        FileDownloadGrant? grant,
        string action,
        string reason,
        CancellationToken cancellationToken)
    {
        await auditLogger.LogSecurityAsync(
            "AccessDenied",
            "File download grant denied.",
            FileGrantDenialMetadata(attachment, grant, reason),
            SecurityEventSeverity.Warning,
            cancellationToken);

        await auditLogger.LogAsync(new AuditLogEntry(
            userId,
            action,
            grant is null ? "FileObject" : "FileDownloadGrant",
            grant?.Id ?? attachment?.FileObjectId,
            "File download grant denied.",
            WorkspaceId: attachment?.WorkspaceId ?? grant?.WorkspaceId,
            ProjectId: attachment?.FileObject?.ProjectId,
            Metadata: FileGrantDenialMetadata(attachment, grant, reason),
            TenantId: currentTenant.IsAvailable
                ? currentTenant.TenantId
                : attachment?.TenantId ?? grant?.TenantId), cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
    }

    private static IReadOnlyDictionary<string, object?> FileGrantDenialMetadata(
        Attachment? attachment,
        FileDownloadGrant? grant,
        string reason)
    {
        return new Dictionary<string, object?>
        {
            ["actorUserId"] = grant?.ActorUserId,
            ["tenantId"] = attachment?.TenantId ?? grant?.TenantId,
            ["workspaceId"] = attachment?.WorkspaceId ?? grant?.WorkspaceId,
            ["fileObjectId"] = attachment?.FileObjectId ?? grant?.FileObjectId,
            ["attachmentId"] = attachment?.Id ?? grant?.AttachmentId,
            ["targetScopeType"] = attachment?.OwnerType?.ToString() ?? grant?.TargetScopeType.ToString(),
            ["targetScopeId"] = attachment?.OwnerId ?? grant?.TargetScopeId,
            ["classification"] = attachment?.FileObject?.Classification?.ToString() ?? grant?.Classification.ToString(),
            ["decision"] = "deny",
            ["decisionReason"] = reason,
            ["grantId"] = grant?.Id,
            ["policyStamp"] = grant?.PolicyStamp
        };
    }

    private static IReadOnlyDictionary<string, object?> FileGrantAuditMetadata(
        FileDownloadGrant grant,
        string decision,
        string reason)
    {
        return new Dictionary<string, object?>
        {
            ["actorUserId"] = grant.ActorUserId,
            ["tenantId"] = grant.TenantId,
            ["workspaceId"] = grant.WorkspaceId,
            ["fileObjectId"] = grant.FileObjectId,
            ["attachmentId"] = grant.AttachmentId,
            ["targetScopeType"] = grant.TargetScopeType.ToString(),
            ["targetScopeId"] = grant.TargetScopeId,
            ["classification"] = grant.Classification.ToString(),
            ["allowedOperation"] = grant.AllowedOperation,
            ["decision"] = decision,
            ["decisionReason"] = reason,
            ["grantId"] = grant.Id,
            ["policyStamp"] = grant.PolicyStamp,
            ["expiresAt"] = grant.ExpiresAt
        };
    }

    private static bool IsAllowedClassification(DataClassification? classification)
    {
        return classification is DataClassification.Public
            or DataClassification.Internal
            or DataClassification.InternalSchoolOperational
            or DataClassification.Private
            or DataClassification.StudentRecordRestricted;
    }

    private static string ComputeFilePolicyStamp(Guid userId, Attachment attachment)
    {
        var basis = string.Join("|",
            userId,
            attachment.TenantId,
            attachment.WorkspaceId,
            attachment.FileObjectId,
            attachment.Id,
            attachment.OwnerType?.ToString() ?? "none",
            attachment.OwnerId?.ToString("D") ?? "none",
            attachment.FileObject?.Classification?.ToString() ?? "missing",
            attachment.FileObject?.Status.ToString() ?? "missing",
            attachment.ScanStatus.ToString());
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(basis));
        return Convert.ToHexString(bytes);
    }

    private static FileDownloadGrantResponse ToGrantResponse(FileDownloadGrant grant, string token)
    {
        return new FileDownloadGrantResponse(
            grant.Id,
            grant.AttachmentId,
            grant.FileObjectId,
            grant.TargetScopeType,
            grant.TargetScopeId,
            grant.Classification.ToString(),
            grant.ExpiresAt,
            token);
    }

    private static string CreateOpaqueToken()
    {
        return Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
    }

    private sealed record FileGrantDecision(bool IsAllowed, string AuditAction, string DenialReason)
    {
        public static FileGrantDecision Allow() => new(true, string.Empty, string.Empty);

        public static FileGrantDecision Deny(string auditAction, string denialReason) => new(false, auditAction, denialReason);
    }

    private static string CreateStorageKey(FileObject fileObject)
    {
        var tenantPart = fileObject.TenantId.ToString("D");
        var filePart = fileObject.Id.ToString("D");
        return fileObject.ProjectId.HasValue
            ? $"tenants/{tenantPart}/projects/{fileObject.ProjectId.Value:D}/files/{filePart}"
            : $"tenants/{tenantPart}/files/{filePart}";
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
            fileObject.ContentType,
            fileObject.SizeBytes,
            fileObject.Status.ToString(),
            fileObject.CreatedAt,
            fileObject.UpdatedAt,
            fileObject.DeletedAt);
    }
}
