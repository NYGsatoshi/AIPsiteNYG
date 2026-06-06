using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Files;
using AipPortal.Application.Projects;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Artifacts;

public sealed class ArtifactService(
    IArtifactRepository artifacts,
    IProjectRepository projects,
    IProjectAuthorizationService projectAuthorization,
    IFileRepository files,
    IFileStorageService storage,
    IArtifactAuthorizationService authorization,
    ICurrentUser currentUser,
    IClock clock,
    IAuditLogger auditLogger,
    INotificationService notifications,
    IUnitOfWork unitOfWork) : IArtifactService
{
    public async Task<Result<IReadOnlyList<ArtifactListItemResponse>>> ListAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) || !await projectAuthorization.CanViewProject(userId, projectId, cancellationToken))
        {
            return Result<IReadOnlyList<ArtifactListItemResponse>>.Failure("Project not found.");
        }

        var items = await artifacts.ListByProjectAsync(projectId, cancellationToken);
        return Result<IReadOnlyList<ArtifactListItemResponse>>.Success(items
            .Where(artifact => !artifact.DeletedAt.HasValue)
            .Select(ToListItem)
            .ToList());
    }

    public async Task<Result<ArtifactDetailResponse>> CreateAsync(Guid projectId, CreateArtifactRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) || !await authorization.CanUploadArtifact(userId, projectId, cancellationToken))
        {
            return Result<ArtifactDetailResponse>.Failure("You are not allowed to create artifacts for this project.");
        }

        if (string.IsNullOrWhiteSpace(request.Title))
        {
            return Result<ArtifactDetailResponse>.Failure("Artifact title is required.");
        }

        var artifact = new Artifact
        {
            ProjectId = projectId,
            Name = request.Title.Trim(),
            Description = request.Description?.Trim(),
            ArtifactType = request.ArtifactType,
            Status = request.Status ?? ArtifactStatus.Draft,
            CreatedByUserId = userId
        };

        await artifacts.AddArtifactAsync(artifact, cancellationToken);
        await auditLogger.LogAsync(new AuditLogEntry(userId, "ArtifactCreated", "Artifact", artifact.Id), cancellationToken);
        await NotifyProjectManagersAsync(projectId, "New artifact uploaded", artifact.Name, artifact.Id, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<ArtifactDetailResponse>.Success(ToDetail(artifact, []));
    }

    public async Task<Result<ArtifactDetailResponse>> GetAsync(Guid artifactId, CancellationToken cancellationToken = default)
    {
        var artifact = await artifacts.GetArtifactAsync(artifactId, cancellationToken);
        if (artifact is null || !TryCurrentUser(out var userId) || !await authorization.CanViewArtifact(userId, artifactId, cancellationToken))
        {
            return Result<ArtifactDetailResponse>.Failure("Artifact not found.");
        }

        var versions = await artifacts.ListVersionsAsync(artifactId, cancellationToken);
        return Result<ArtifactDetailResponse>.Success(ToDetail(artifact, versions.Where(version => !version.DeletedAt.HasValue).Select(ToVersion).ToList()));
    }

    public async Task<Result<ArtifactDetailResponse>> UpdateAsync(Guid artifactId, UpdateArtifactRequest request, CancellationToken cancellationToken = default)
    {
        var artifact = await artifacts.GetArtifactAsync(artifactId, cancellationToken);
        if (artifact is null || !TryCurrentUser(out var userId) || !await authorization.CanUpdateArtifact(userId, artifactId, cancellationToken))
        {
            return Result<ArtifactDetailResponse>.Failure("Artifact not found.");
        }

        if (request.Title is not null)
        {
            if (string.IsNullOrWhiteSpace(request.Title))
            {
                return Result<ArtifactDetailResponse>.Failure("Artifact title is required.");
            }

            artifact.Name = request.Title.Trim();
        }

        var previousStatus = artifact.Status;
        artifact.Description = request.Description?.Trim() ?? artifact.Description;
        artifact.ArtifactType = request.ArtifactType ?? artifact.ArtifactType;
        artifact.Status = request.Status ?? artifact.Status;

        await auditLogger.LogAsync(new AuditLogEntry(userId, "ArtifactUpdated", "Artifact", artifact.Id), cancellationToken);
        if (artifact.Status != previousStatus)
        {
            await NotifyStatusAsync(artifact, cancellationToken);
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);
        var versions = await artifacts.ListVersionsAsync(artifactId, cancellationToken);
        return Result<ArtifactDetailResponse>.Success(ToDetail(artifact, versions.Where(version => !version.DeletedAt.HasValue).Select(ToVersion).ToList()));
    }

    public async Task<Result> DeleteAsync(Guid artifactId, CancellationToken cancellationToken = default)
    {
        var artifact = await artifacts.GetArtifactAsync(artifactId, cancellationToken);
        if (artifact is null || !TryCurrentUser(out var userId) || !await authorization.CanUpdateArtifact(userId, artifactId, cancellationToken))
        {
            return Result.Failure("Artifact not found.");
        }

        artifact.Status = ArtifactStatus.Archived;
        artifact.MarkDeleted(clock.UtcNow);
        await auditLogger.LogAsync(new AuditLogEntry(userId, "ArtifactArchived", "Artifact", artifact.Id), cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result<IReadOnlyList<ArtifactVersionResponse>>> ListVersionsAsync(Guid artifactId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) || !await authorization.CanViewArtifact(userId, artifactId, cancellationToken))
        {
            return Result<IReadOnlyList<ArtifactVersionResponse>>.Failure("Artifact not found.");
        }

        var versions = await artifacts.ListVersionsAsync(artifactId, cancellationToken);
        return Result<IReadOnlyList<ArtifactVersionResponse>>.Success(versions
            .Where(version => !version.DeletedAt.HasValue)
            .Select(ToVersion)
            .ToList());
    }

    public async Task<Result<ArtifactVersionResponse>> UploadVersionAsync(Guid artifactId, UploadArtifactVersionInput input, CancellationToken cancellationToken = default)
    {
        var artifact = await artifacts.GetArtifactAsync(artifactId, cancellationToken);
        if (artifact is null || !TryCurrentUser(out var userId) || !await authorization.CanUpdateArtifact(userId, artifactId, cancellationToken))
        {
            return Result<ArtifactVersionResponse>.Failure("Artifact not found.");
        }

        var saved = await storage.SaveAsync(input.OriginalFileName, input.ContentType, input.Length, input.Content, cancellationToken);
        if (!saved.IsSuccess)
        {
            return Result<ArtifactVersionResponse>.Failure(saved.Error!);
        }

        var version = new ArtifactVersion
        {
            ArtifactId = artifactId,
            VersionNumber = await artifacts.GetNextVersionNumberAsync(artifactId, cancellationToken),
            Notes = input.ChangeNote?.Trim(),
            CreatedByUserId = userId
        };

        var project = await projects.GetProjectAsync(artifact.ProjectId, cancellationToken);
        if (project is null)
        {
            return Result<ArtifactVersionResponse>.Failure("Project not found.");
        }

        var attachment = new Attachment
        {
            WorkspaceId = project.WorkspaceId,
            OwnerType = AttachmentOwnerType.ArtifactVersion,
            OwnerId = version.Id,
            OwnerUserId = userId,
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

        version.AttachmentId = attachment.Id;
        version.Attachment = attachment;
        await files.AddAttachmentAsync(attachment, cancellationToken);
        await artifacts.AddVersionAsync(version, cancellationToken);
        artifact.CurrentVersionId = version.Id;
        await auditLogger.LogAsync(new AuditLogEntry(userId, "ArtifactVersionUploaded", "ArtifactVersion", version.Id), cancellationToken);
        await NotifyProjectManagersAsync(artifact.ProjectId, "New artifact version uploaded", artifact.Name, artifact.Id, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<ArtifactVersionResponse>.Success(ToVersion(version));
    }

    public async Task<Result<FileDownloadResponse>> DownloadVersionAsync(Guid versionId, CancellationToken cancellationToken = default)
    {
        var version = await artifacts.GetVersionAsync(versionId, cancellationToken);
        if (version?.Attachment is null || !TryCurrentUser(out var userId) || !await authorization.CanDownloadArtifactVersion(userId, versionId, cancellationToken))
        {
            return Result<FileDownloadResponse>.Failure("Artifact version not found.");
        }

        var content = await storage.OpenReadAsync(version.Attachment.StorageKey, cancellationToken);
        await auditLogger.LogAsync(new AuditLogEntry(userId, "ArtifactVersionDownloaded", "ArtifactVersion", version.Id), cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<FileDownloadResponse>.Success(new FileDownloadResponse(content, version.Attachment.FileName, version.Attachment.ContentType, version.Attachment.SizeBytes));
    }

    public async Task<Result> DeleteVersionAsync(Guid versionId, CancellationToken cancellationToken = default)
    {
        var version = await artifacts.GetVersionAsync(versionId, cancellationToken);
        if (version?.Artifact is null || !TryCurrentUser(out var userId) || !await authorization.CanUpdateArtifact(userId, version.ArtifactId, cancellationToken))
        {
            return Result.Failure("Artifact version not found.");
        }

        version.MarkDeleted(clock.UtcNow);
        if (version.Artifact.CurrentVersionId == version.Id)
        {
            var latest = (await artifacts.ListVersionsAsync(version.ArtifactId, cancellationToken))
                .Where(item => item.Id != version.Id && !item.DeletedAt.HasValue)
                .OrderByDescending(item => item.VersionNumber)
                .FirstOrDefault();
            version.Artifact.CurrentVersionId = latest?.Id;
        }

        await auditLogger.LogAsync(new AuditLogEntry(userId, "ArtifactVersionDeleted", "ArtifactVersion", version.Id), cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    private async Task NotifyStatusAsync(Artifact artifact, CancellationToken cancellationToken)
    {
        var title = artifact.Status switch
        {
            ArtifactStatus.Submitted => "Artifact submitted for review",
            ArtifactStatus.Reviewed => "Artifact reviewed",
            ArtifactStatus.Approved => "Artifact approved",
            _ => null
        };

        if (title is not null)
        {
            await NotifyProjectManagersAsync(artifact.ProjectId, title, artifact.Name, artifact.Id, cancellationToken);
        }
    }

    private async Task NotifyProjectManagersAsync(Guid projectId, string title, string body, Guid artifactId, CancellationToken cancellationToken)
    {
        var members = await projects.ListMembersAsync(projectId, cancellationToken);
        foreach (var member in members.Where(member => member.Role is ProjectRole.Owner or ProjectRole.Manager or ProjectRole.Reviewer))
        {
            await notifications.NotifyAsync(member.UserId, title, body, "Artifact", artifactId, cancellationToken);
        }
    }

    private bool TryCurrentUser(out Guid userId)
    {
        userId = currentUser.UserId ?? Guid.Empty;
        return currentUser.IsAuthenticated && currentUser.UserId.HasValue;
    }

    private static ArtifactListItemResponse ToListItem(Artifact artifact)
    {
        return new ArtifactListItemResponse(artifact.Id, artifact.ProjectId, artifact.Name, artifact.Description, artifact.ArtifactType, artifact.Status, artifact.CurrentVersionId, artifact.CreatedByUserId, artifact.CreatedAt, artifact.UpdatedAt);
    }

    private static ArtifactDetailResponse ToDetail(Artifact artifact, IReadOnlyList<ArtifactVersionResponse> versions)
    {
        return new ArtifactDetailResponse(artifact.Id, artifact.ProjectId, artifact.Name, artifact.Description, artifact.ArtifactType, artifact.Status, artifact.CurrentVersionId, artifact.CreatedByUserId, artifact.CreatedAt, artifact.UpdatedAt, versions);
    }

    private static ArtifactVersionResponse ToVersion(ArtifactVersion version)
    {
        var attachment = version.Attachment ?? new Attachment();
        return new ArtifactVersionResponse(
            version.Id,
            version.ArtifactId,
            version.VersionNumber,
            attachment.FileName,
            attachment.StoredFileName,
            attachment.FilePath,
            attachment.ContentType,
            attachment.SizeBytes,
            version.CreatedByUserId,
            version.Notes,
            version.CreatedAt,
            version.DeletedAt);
    }
}
