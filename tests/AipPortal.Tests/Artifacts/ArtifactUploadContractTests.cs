using System.ComponentModel.DataAnnotations;
using AipPortal.Application.Artifacts;
using AipPortal.Application.Common;
using AipPortal.Application.Files;
using AipPortal.Web.Controllers;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Tests.Artifacts;

public sealed class ArtifactUploadContractTests
{
    [Fact]
    public void Upload_forms_require_a_file()
    {
        foreach (var form in new object[] { new UploadArtifactVersionForm(), new UploadAttachmentForm() })
        {
            var errors = new List<ValidationResult>();
            Assert.False(Validator.TryValidateObject(form, new ValidationContext(form), errors, true));
            Assert.Contains(errors, error => error.MemberNames.Contains("File"));
        }
    }

    [Fact]
    public async Task Missing_file_is_rejected_before_calling_service()
    {
        var controller = new ArtifactsController(null!);
        Assert.IsType<BadRequestObjectResult>(await controller.UploadVersion(Guid.NewGuid(), new(), default));
    }

    [Theory]
    [InlineData("Artifact not found.", 404)]
    [InlineData("Empty files are not allowed.", 400)]
    public async Task Upload_preserves_missing_resource_and_validation_distinction(string error, int status)
    {
        using var stream = new MemoryStream(new byte[] { 1 });
        var controller = new ArtifactsController(new ArtifactStub(error));
        var form = new UploadArtifactVersionForm
        {
            File = new FormFile(stream, 0, 1, "File", "report.txt")
            {
                Headers = new HeaderDictionary(),
                ContentType = "text/plain"
            }
        };

        var result = Assert.IsType<ObjectResult>(await controller.UploadVersion(Guid.NewGuid(), form, default));

        Assert.Equal(status, result.StatusCode);
    }

    private sealed class ArtifactStub(string error) : IArtifactService
    {
        public Task<Result<ArtifactVersionResponse>> UploadVersionAsync(Guid artifactId, UploadArtifactVersionInput input, CancellationToken cancellationToken = default)
            => Task.FromResult(Result<ArtifactVersionResponse>.Failure(error));

        public Task<Result<IReadOnlyList<ArtifactListItemResponse>>> ListAsync(Guid projectId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<Result<ArtifactDetailResponse>> CreateAsync(Guid projectId, CreateArtifactRequest request, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<Result<ArtifactDetailResponse>> GetAsync(Guid artifactId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<Result<ArtifactDetailResponse>> UpdateAsync(Guid artifactId, UpdateArtifactRequest request, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<Result> DeleteAsync(Guid artifactId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<Result<IReadOnlyList<ArtifactVersionResponse>>> ListVersionsAsync(Guid artifactId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<Result<FileDownloadResponse>> DownloadVersionAsync(Guid versionId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<Result> DeleteVersionAsync(Guid versionId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }
}
