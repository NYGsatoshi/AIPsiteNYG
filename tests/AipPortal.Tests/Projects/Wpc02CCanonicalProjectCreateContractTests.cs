using System.Reflection;
using System.Text.Json;
using AipPortal.Application.Projects;
using AipPortal.Web.Controllers;
using AipPortal.Web.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Tests.Projects;

[Trait("Scope", "WPC02C")]
public sealed class Wpc02CCanonicalProjectCreateContractTests
{
    private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);

    [Fact]
    public void RequestRejectsBodyWorkspaceScopeOverride()
    {
        var workspaceId = Guid.NewGuid();
        var payload = $$"""
        {
          "title": "Canonical Project",
          "workspaceId": "{{workspaceId}}"
        }
        """;

        Assert.Throws<JsonException>(() =>
            JsonSerializer.Deserialize<CanonicalCreateProjectRequest>(payload, WebJson));
    }

    [Fact]
    public void RequestKeepsGroupAndVisibilityOptional()
    {
        const string payload = """
        {
          "title": "Canonical Project"
        }
        """;

        var request = JsonSerializer.Deserialize<CanonicalCreateProjectRequest>(payload, WebJson);

        Assert.NotNull(request);
        Assert.Equal("Canonical Project", request.Title);
        Assert.Null(request.GroupId);
        Assert.Null(request.Visibility);
    }

    [Fact]
    public void WpcEnvelopeClassifierRecognizesOnlyCanonicalWorkspaceScopedProjectCreateShape()
    {
        var workspaceId = Guid.NewGuid();

        Assert.True(ApiEnvelope.IsWorkspaceCreationPath($"/api/workspaces/{workspaceId}/projects"));
        Assert.True(ApiEnvelope.IsWorkspaceCreationPath($"/api/workspaces/{workspaceId}/projects/"));
        Assert.False(ApiEnvelope.IsWorkspaceCreationPath("/api/workspaces/not-a-guid/projects"));
        Assert.False(ApiEnvelope.IsWorkspaceCreationPath($"/api/workspaces/{workspaceId}/projects/extra"));
        Assert.False(ApiEnvelope.IsWorkspaceCreationPath($"/api/workspaces/{workspaceId}/project"));
    }

    [Fact]
    public void ControllerPinsCanonicalRouteAuthorizationAndIdempotencyHeader()
    {
        var controllerType = typeof(WorkspaceProjectsController);
        Assert.Single(controllerType.GetCustomAttributes<AuthorizeAttribute>());

        var create = controllerType.GetMethod(nameof(WorkspaceProjectsController.Create));
        Assert.NotNull(create);

        var post = Assert.Single(create.GetCustomAttributes<HttpPostAttribute>());
        Assert.Equal("api/workspaces/{workspaceId:guid}/projects", post.Template);

        var parameters = create.GetParameters();
        Assert.Contains(parameters, parameter => parameter.Name == "workspaceId" && parameter.ParameterType == typeof(Guid));
        var idempotencyParameter = Assert.Single(parameters.Where(parameter => parameter.Name == "idempotencyKey"));
        var fromHeader = Assert.Single(idempotencyParameter.GetCustomAttributes<FromHeaderAttribute>());
        Assert.Equal("Idempotency-Key", fromHeader.Name);
    }
}
