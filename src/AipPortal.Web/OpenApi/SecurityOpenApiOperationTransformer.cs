using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;

namespace AipPortal.Web.OpenApi;

/// <summary>
/// Describes cross-cutting authentication, authorization, CSRF, and request
/// validation responses that execute outside controller action return types.
/// </summary>
public sealed class SecurityOpenApiOperationTransformer : IOpenApiOperationTransformer
{
    public const string CookieSchemeName = "CookieAuth";
    private const string AuthenticationCookieName = ".AipPortal.Auth";

    public Task TransformAsync(
        OpenApiOperation operation,
        OpenApiOperationTransformerContext context,
        CancellationToken cancellationToken)
    {
        var document = context.Document ??
            throw new InvalidOperationException("OpenAPI operation transformer requires its document context.");
        EnsureCookieSecurityScheme(document);

        var endpointMetadata = context.Description.ActionDescriptor.EndpointMetadata;
        var requiresAuthorization = endpointMetadata.OfType<IAuthorizeData>().Any() &&
                                    !endpointMetadata.OfType<IAllowAnonymous>().Any();

        if (requiresAuthorization)
        {
            operation.Security ??= [];
            operation.Security.Add(new OpenApiSecurityRequirement
            {
                [new OpenApiSecuritySchemeReference(CookieSchemeName, document)] = []
            });

            AddResponse(operation, "401", "Authentication is required.");
            AddResponse(operation, "403", "Authentication, authorization, or CSRF validation failed.");
            AddResponse(operation, "404", "The protected resource is absent or not visible to the current actor.");
        }
        else if (RequiresCsrf(context.Description.HttpMethod))
        {
            AddResponse(operation, "403", "CSRF validation failed for an authenticated unsafe request.");
        }

        if (context.Description.ParameterDescriptions.Count > 0)
        {
            AddResponse(operation, "400", "The request parameters or body are invalid.");
        }

        if (operation.RequestBody is not null)
        {
            // ApiExplorer includes the legacy text/json formatter media type,
            // but the production request pipeline rejects it with 415. Keep
            // the authoritative security contract aligned with runtime input.
            operation.RequestBody.Content?.Remove("text/json");
            AddResponse(operation, "415", "The request content type is not supported.");
        }

        return Task.CompletedTask;
    }

    private static void EnsureCookieSecurityScheme(OpenApiDocument document)
    {
        document.Components ??= new OpenApiComponents();
        document.Components.SecuritySchemes ??= new Dictionary<string, IOpenApiSecurityScheme>();
        if (!document.Components.SecuritySchemes.ContainsKey(CookieSchemeName))
        {
            document.Components.SecuritySchemes.Add(
                CookieSchemeName,
                new OpenApiSecurityScheme
                {
                    Type = SecuritySchemeType.ApiKey,
                    In = ParameterLocation.Cookie,
                    Name = AuthenticationCookieName,
                    Description = "AIP Portal authenticated session cookie."
                });
        }
    }

    private static void AddResponse(OpenApiOperation operation, string status, string description)
    {
        operation.Responses ??= new OpenApiResponses();
        if (!operation.Responses.ContainsKey(status))
        {
            operation.Responses.Add(status, new OpenApiResponse { Description = description });
        }
    }

    private static bool RequiresCsrf(string? method) =>
        !string.IsNullOrWhiteSpace(method) &&
        !HttpMethods.IsGet(method) &&
        !HttpMethods.IsHead(method) &&
        !HttpMethods.IsOptions(method) &&
        !HttpMethods.IsTrace(method);
}
