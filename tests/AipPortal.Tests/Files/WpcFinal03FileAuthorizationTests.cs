using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Files;
using AipPortal.Application.Projects;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Tests.Files;

[Trait("Scope", "WPCFinal03")]
public sealed class WpcFinal03FileAuthorizationTests
{
    [Fact]
    public async Task WorkspaceVisibleReaderCannotUploadProjectAttachment()
    {
        var projectId = Guid.NewGuid();
        var projectAuthorization = new ProjectAuthorizationStub
        {
            CanViewResult = true,
            CanContributeResult = false
        };
        var service = CreateService(projectId, projectAuthorization);

        var allowed = await service.CanUploadAttachment(
            Guid.NewGuid(),
            AttachmentOwnerType.TaskItem,
            Guid.NewGuid());

        Assert.False(allowed);
        Assert.Equal(1, projectAuthorization.ContributeCalls);
        Assert.Equal(0, projectAuthorization.ViewCalls);
    }

    [Fact]
    public async Task ExplicitCurrentContributorCanUploadProjectAttachment()
    {
        var projectId = Guid.NewGuid();
        var projectAuthorization = new ProjectAuthorizationStub
        {
            CanContributeResult = true
        };
        var service = CreateService(projectId, projectAuthorization);

        var allowed = await service.CanUploadAttachment(
            Guid.NewGuid(),
            AttachmentOwnerType.TaskItem,
            Guid.NewGuid());

        Assert.True(allowed);
        Assert.Equal(1, projectAuthorization.ContributeCalls);
    }

    [Fact]
    public async Task HistoricalUploaderCannotDeleteAfterCurrentContributionIsRevoked()
    {
        var userId = Guid.NewGuid();
        var projectAuthorization = new ProjectAuthorizationStub
        {
            CanContributeResult = false,
            CanManageResult = true
        };
        var service = CreateService(Guid.NewGuid(), projectAuthorization);
        var attachment = NewAttachment(userId);

        var allowed = await service.CanDeleteAttachment(userId, attachment);

        Assert.False(allowed);
        Assert.Equal(1, projectAuthorization.ContributeCalls);
        Assert.Equal(0, projectAuthorization.ManageCalls);
    }

    [Fact]
    public async Task CurrentUploaderCanDeleteWithoutProjectManagementAuthority()
    {
        var userId = Guid.NewGuid();
        var projectAuthorization = new ProjectAuthorizationStub
        {
            CanContributeResult = true,
            CanManageResult = false
        };
        var service = CreateService(Guid.NewGuid(), projectAuthorization);
        var attachment = NewAttachment(userId);

        var allowed = await service.CanDeleteAttachment(userId, attachment);

        Assert.True(allowed);
        Assert.Equal(1, projectAuthorization.ContributeCalls);
        Assert.Equal(0, projectAuthorization.ManageCalls);
    }

    [Fact]
    public async Task ExplicitCurrentProjectManagerCanModerateAnotherUsersAttachment()
    {
        var projectAuthorization = new ProjectAuthorizationStub
        {
            CanContributeResult = true,
            CanManageResult = true
        };
        var service = CreateService(Guid.NewGuid(), projectAuthorization);
        var attachment = NewAttachment(Guid.NewGuid());

        var allowed = await service.CanDeleteAttachment(Guid.NewGuid(), attachment);

        Assert.True(allowed);
        Assert.Equal(1, projectAuthorization.ContributeCalls);
        Assert.Equal(1, projectAuthorization.ManageCalls);
    }

    private static FileAuthorizationService CreateService(
        Guid projectId,
        IProjectAuthorizationService projectAuthorization) =>
        new(
            new FileRepositoryStub(new FileOwnerContext(Guid.NewGuid(), projectId)),
            projectAuthorization,
            null!,
            null!,
            null!);

    private static Attachment NewAttachment(Guid uploadedByUserId) => new()
    {
        TenantId = Guid.NewGuid(),
        FileObjectId = Guid.NewGuid(),
        WorkspaceId = Guid.NewGuid(),
        OwnerType = AttachmentOwnerType.TaskItem,
        OwnerId = Guid.NewGuid(),
        OwnerUserId = Guid.NewGuid(),
        UploadedByUserId = uploadedByUserId,
        FileName = "evidence.txt",
        StoredFileName = "stored.txt",
        FilePath = "internal/evidence.txt",
        ContentType = "text/plain",
        Extension = ".txt",
        SizeBytes = 8,
        StorageProvider = "test",
        StorageKey = "internal/evidence.txt",
        ScanStatus = FileScanStatus.Clean
    };

    private sealed class ProjectAuthorizationStub : IProjectAuthorizationService
    {
        public bool CanViewResult { get; init; }
        public bool CanManageResult { get; init; }
        public bool CanContributeResult { get; init; }
        public int ViewCalls { get; private set; }
        public int ManageCalls { get; private set; }
        public int ContributeCalls { get; private set; }

        public Task<bool> CanViewProject(Guid userId, Guid projectId, CancellationToken cancellationToken = default)
        {
            ViewCalls++;
            return Task.FromResult(CanViewResult);
        }

        public Task<bool> CanManageProject(Guid userId, Guid projectId, CancellationToken cancellationToken = default)
        {
            ManageCalls++;
            return Task.FromResult(CanManageResult);
        }

        public Task<bool> CanContributeProject(Guid userId, Guid projectId, CancellationToken cancellationToken = default)
        {
            ContributeCalls++;
            return Task.FromResult(CanContributeResult);
        }

        public Task<bool> CanCreateProject(Guid userId, Guid workspaceId, Guid groupId, CancellationToken cancellationToken = default) =>
            Task.FromResult(false);
    }

    private sealed class FileRepositoryStub(FileOwnerContext owner) : IFileRepository
    {
        public Task<FileOwnerContext?> ResolveOwnerAsync(
            AttachmentOwnerType ownerType,
            Guid ownerId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<FileOwnerContext?>(owner);

        public Task<FileObject?> GetFileObjectAsync(Guid fileObjectId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<PagedResponse<Attachment>> ListWorkspaceFileObjectsAsync(
            Guid workspaceId,
            int page,
            int pageSize,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task AddFileObjectAsync(FileObject fileObject, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<Attachment?> GetAttachmentAsync(Guid attachmentId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<Attachment?> GetAttachmentByFileObjectAsync(Guid fileObjectId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task AddAttachmentAsync(Attachment attachment, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }
}