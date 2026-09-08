using System.ComponentModel.DataAnnotations;
using AipPortal.Application.Artifacts;
using AipPortal.Application.Common;
using AipPortal.Application.Files;
using AipPortal.Web.Controllers;
using AipPortal.Web.OpenApi;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.ApiExplorer;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;

namespace AipPortal.Tests.Artifacts;

public sealed class ArtifactUploadContractTests
{
    [Theory]
    [InlineData(typeof(UploadArtifactVersionForm))]
    [InlineData(typeof(UploadAttachmentForm))]
    public async Task Multipart_schema_preserves_required_file(Type formType)
    {
        var schema = new OpenApiSchema
        {
            Properties = new Dictionary<string, IOpenApiSchema>
            {
                ["File"] = new OpenApiSchema { Type = JsonSchemaType.String, Format = "binary" },
                ["ChangeNote"] = new OpenApiSchema { Type = JsonSchemaType.String }
            }
        };
        var operation = new OpenApiOperation
        {
            RequestBody = new OpenApiRequestBody
            {
                Content = new Dictionary<string, OpenApiMediaType>
                {
                    ["multipart/form-data"] = new() { Schema = schema }
                }
            }
        };
        var context = new OpenApiOperationTransformerContext
        {
            DocumentName = "v1",
            Document = new OpenApiDocument(),
            ApplicationServices = null!,
            Description = new ApiDescription
            {
                HttpMethod = "POST",
                ActionDescriptor = new ActionDescriptor
                {
                    EndpointMetadata = [],
                    Parameters = [new ParameterDescriptor { Name = "form", ParameterType = formType }]
                }
            }
        };

        await new SecurityOpenApiOperationTransformer().TransformAsync(operation, context, default);

        Assert.NotNull(schema.Required);
        Assert.Contains("File", schema.Required);
        Assert.DoesNotContain("ChangeNote", schema.Required);
    }

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

    [Fact]
    public async Task Attachment_missing_file_is_rejected_before_calling_service()
    {
        var controller = new AttachmentsController(null!);
        Assert.IsType<BadRequestObjectResult>(await controller.Upload(new(), default));
    }

    [Theory]
    [InlineData("Artifact not found.", StatusCodes.Status404NotFound)]
    [InlineData("Empty files are not allowed.", StatusCodes.Status400BadRequest)]
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

        public Task<Result<IReadOnlyList<ArtifactListItemResponse>>> ListAsync(Guid projectId, CancellationToken cancellationToken = default)
            => throw new NotSupportedException(nameof(ListAsync));

        public Task<Result<ArtifactDetailResponse>> CreateAsync(Guid projectId, CreateArtifactRequest request, CancellationToken cancellationToken = default)
            => throw new NotSupportedException(nameof(CreateAsync));

        public Task<Result<ArtifactDetailResponse>> GetAsync(Guid artifactId, CancellationToken cancellationToken = default)
            => throw new NotSupportedException(nameof(GetAsync));

        public Task<Result<ArtifactDetailResponse>> UpdateAsync(Guid artifactId, UpdateArtifactRequest request, CancellationToken cancellationToken = default)
            => throw new NotSupportedException(nameof(UpdateAsync));

        public Task<Result> DeleteAsync(Guid artifactId, CancellationToken cancellationToken = default)
            => throw new NotSupportedException(nameof(DeleteAsync));

        public Task<Result<IReadOnlyList<ArtifactVersionResponse>>> ListVersionsAsync(Guid artifactId, CancellationToken cancellationToken = default)
            => throw new NotSupportedException(nameof(ListVersionsAsync));

        public Task<Result<FileDownloadResponse>> DownloadVersionAsync(Guid versionId, CancellationToken cancellationToken = default)
            => throw new NotSupportedException(nameof(DownloadVersionAsync));

        public Task<Result> DeleteVersionAsync(Guid versionId, CancellationToken cancellationToken = default)
            => throw new NotSupportedException(nameof(DeleteVersionAsync));
    }
}
