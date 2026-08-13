using System.Text.Json;
using AipPortal.Application.Common;
using AipPortal.Application.Workspaces;
using AipPortal.Domain.Enums;
using AipPortal.Web.Controllers;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Tests.Workspaces;

public sealed class WorkspacesControllerTests
{
    [Fact]
    public async Task CreateForwardsIdempotencyIdentityAndReturnsCreatedResult()
    {
        var value = new WorkspaceDetailResponse(
            Guid.NewGuid(),
            "Workspace",
            null,
            null,
            WorkspaceStatus.Active,
            Guid.NewGuid(),
            DateTimeOffset.UtcNow,
            null);
        var service = new StubWorkspaceService
        {
            CreateResult = Result<WorkspaceDetailResponse>.Success(value)
        };
        var controller = Controller(service);

        var action = await controller.Create(
            new CreateWorkspaceRequest("Workspace", null, null),
            "browser-request-001",
            CancellationToken.None);

        var created = Assert.IsType<CreatedAtActionResult>(action);
        Assert.Equal(nameof(WorkspacesController.Get), created.ActionName);
        Assert.Equal(value.Id, created.RouteValues!["workspaceId"]);
        Assert.Equal("browser-request-001", service.ClientRequestIdentity);
    }

    [Fact]
    public async Task ReusedIdentityMismatchReturnsSafeConflictEnvelope()
    {
        var service = new StubWorkspaceService
        {
            CreateResult = Result<WorkspaceDetailResponse>.Failure(new ApplicationErrorDetail(
                "IdempotencyConflict",
                "The Idempotency-Key was already used with a different Workspace request."))
        };
        var controller = Controller(service);

        var action = await controller.Create(
            new CreateWorkspaceRequest("Workspace", null, null),
            "browser-request-001",
            CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(action);
        using var envelope = JsonDocument.Parse(JsonSerializer.Serialize(conflict.Value));
        Assert.Equal(
            "IdempotencyConflict",
            envelope.RootElement.GetProperty("error").GetProperty("code").GetString());
        Assert.Equal(
            "workspace",
            envelope.RootElement.GetProperty("error").GetProperty("target").GetString());
    }

    [Fact]
    public async Task CapabilityProjectionIsBackendOwned()
    {
        var service = new StubWorkspaceService
        {
            CapabilityResult = Result<WorkspaceCapabilitiesResponse>.Success(
                new WorkspaceCapabilitiesResponse(true))
        };
        var controller = Controller(service);

        var action = await controller.Capabilities(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(action);
        Assert.True(Assert.IsType<WorkspaceCapabilitiesResponse>(ok.Value).CanCreate);
    }

    private static WorkspacesController Controller(IWorkspaceService service) => new(service)
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { TraceIdentifier = "wpc01-request" }
        }
    };

    private sealed class StubWorkspaceService : IWorkspaceService
    {
        public Result<WorkspaceDetailResponse> CreateResult { get; init; } =
            Result<WorkspaceDetailResponse>.Failure("Not configured.");
        public Result<WorkspaceCapabilitiesResponse> CapabilityResult { get; init; } =
            Result<WorkspaceCapabilitiesResponse>.Failure("Not configured.");
        public string? ClientRequestIdentity { get; private set; }

        public Task<Result<IReadOnlyList<WorkspaceListItemResponse>>> ListAsync(CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<Result<WorkspaceCapabilitiesResponse>> GetCapabilitiesAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(CapabilityResult);

        public Task<Result<WorkspaceDetailResponse>> CreateAsync(
            CreateWorkspaceRequest request,
            string? clientRequestIdentity,
            CancellationToken cancellationToken = default)
        {
            ClientRequestIdentity = clientRequestIdentity;
            return Task.FromResult(CreateResult);
        }

        public Task<Result<WorkspaceDetailResponse>> GetAsync(Guid workspaceId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
        public Task<Result<WorkspaceDetailResponse>> UpdateAsync(Guid workspaceId, UpdateWorkspaceRequest request, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
        public Task<Result> ArchiveAsync(Guid workspaceId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
        public Task<Result> RestoreAsync(Guid workspaceId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
        public Task<Result<IReadOnlyList<WorkspaceMemberResponse>>> ListMembersAsync(Guid workspaceId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
        public Task<Result<WorkspaceMemberResponse>> AddMemberAsync(Guid workspaceId, AddWorkspaceMemberRequest request, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
        public Task<Result<WorkspaceMemberResponse>> UpdateMemberAsync(Guid workspaceId, Guid userId, UpdateWorkspaceMemberRequest request, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
        public Task<Result> RemoveMemberAsync(Guid workspaceId, Guid userId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }
}
