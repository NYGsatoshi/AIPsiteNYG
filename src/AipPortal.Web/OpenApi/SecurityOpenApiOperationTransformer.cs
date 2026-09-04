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
        var hasAuthorizationBoundary = endpointMetadata.OfType<IAuthorizeData>().Any();
        var allowsAnonymousTransport = endpointMetadata.OfType<IAllowAnonymous>().Any();
        var requiresAuthorization = hasAuthorizationBoundary && !allowsAnonymousTransport;

        if (requiresAuthorization)
        {
            operation.Security ??= [];
            operation.Security.Add(new OpenApiSecurityRequirement
            {
                [new OpenApiSecuritySchemeReference(CookieSchemeName, document)] = []
            });

        }

        if (hasAuthorizationBoundary)
        {
            // A small set of canonical command actions deliberately allows the
            // transport through so the application layer can return its typed
            // 401 envelope. They retain the controller authorization boundary.
            AddResponse(operation, "401", "Authentication is required.");
            AddResponse(operation, "403", "Authentication, authorization, or CSRF validation failed.");
            AddResponse(operation, "404", "The protected resource is absent or not visible to the current actor.");
        }
        else if (RequiresCsrf(context.Description.HttpMethod))
        {
            AddResponse(operation, "403", "CSRF validation failed for an authenticated unsafe request.");
        }

        if (context.Description.RelativePath?.Contains('{') == true)
        {
            AddResponse(operation, "404", "The route value is invalid or the addressed resource does not exist.");
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

        foreach (var status in new[] { "400", "401", "403", "404", "415" })
        {
            if (operation.Responses?.ContainsKey(status) == true)
            {
                AddErrorResponseContent(operation, status);
            }
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

        AddErrorResponseContent(operation, status);
    }

    private static void AddErrorResponseContent(OpenApiOperation operation, string status)
    {
        // Framework model validation and status-code handling emit RFC 9457
        // Problem Details, while authorization and CSRF middleware emit the
        // existing JSON error envelope. Preserve action-specific media types
        // and document both cross-cutting wire formats.
        if (operation.Responses?.TryGetValue(status, out var describedResponse) == true &&
            describedResponse is OpenApiResponse response)
        {
            response.Content ??= new Dictionary<string, OpenApiMediaType>();
            if (!response.Content.ContainsKey("application/json"))
            {
                response.Content.Add("application/json", new OpenApiMediaType());
            }

            if (!response.Content.ContainsKey("application/problem+json"))
            {
                response.Content.Add("application/problem+json", new OpenApiMediaType());
            }
        }
    }

    private static bool RequiresCsrf(string? method) =>
        !string.IsNullOrWhiteSpace(method) &&
        !HttpMethods.IsGet(method) &&
        !HttpMethods.IsHead(method) &&
        !HttpMethods.IsOptions(method) &&
        !HttpMethods.IsTrace(method);
}
