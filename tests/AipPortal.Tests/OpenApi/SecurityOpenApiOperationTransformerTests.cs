using AipPortal.Web.OpenApi;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.ApiExplorer;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;

namespace AipPortal.Tests.OpenApi;

public sealed class SecurityOpenApiOperationTransformerTests
{
    [Fact]
    public async Task AllowAnonymous_emits_explicit_empty_operation_security()
    {
        var operation = new OpenApiOperation();
        var context = CreateContext(new AllowAnonymousAttribute());

        await new SecurityOpenApiOperationTransformer().TransformAsync(operation, context, default);

        Assert.NotNull(operation.Security);
        Assert.Empty(operation.Security);
    }

    [Fact]
    public async Task AllowAnonymous_overrides_authorization_security_requirement()
    {
        var operation = new OpenApiOperation();
        var context = CreateContext(new AuthorizeAttribute(), new AllowAnonymousAttribute());

        await new SecurityOpenApiOperationTransformer().TransformAsync(operation, context, default);

        Assert.NotNull(operation.Security);
        Assert.Empty(operation.Security);
    }

    [Fact]
    public async Task Authorize_emits_cookie_auth_security_requirement()
    {
        var operation = new OpenApiOperation();
        var context = CreateContext(new AuthorizeAttribute());

        await new SecurityOpenApiOperationTransformer().TransformAsync(operation, context, default);

        var requirement = Assert.Single(operation.Security!);
        Assert.Contains(
            requirement.Keys,
            scheme => scheme is OpenApiSecuritySchemeReference reference &&
                      reference.Reference.Id == SecurityOpenApiOperationTransformer.CookieSchemeName);
    }

    private static OpenApiOperationTransformerContext CreateContext(params object[] endpointMetadata) =>
        new()
        {
            DocumentName = "v1",
            Document = new OpenApiDocument(),
            ApplicationServices = null!,
            Description = new ApiDescription
            {
                HttpMethod = "GET",
                ActionDescriptor = new ActionDescriptor
                {
                    EndpointMetadata = endpointMetadata.ToList(),
                    Parameters = []
                }
            }
        };
}
