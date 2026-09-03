using AipPortal.Application.Projects;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;

namespace AipPortal.Web.OpenApi;

/// <summary>
/// Describes custom JSON converter-backed PATCH sentinel types by their actual
/// wire representation so generated OpenAPI remains useful to fuzzers/scanners.
/// </summary>
public sealed class SecurityOpenApiSchemaTransformer : IOpenApiSchemaTransformer
{
    public Task TransformAsync(
        OpenApiSchema schema,
        OpenApiSchemaTransformerContext context,
        CancellationToken cancellationToken)
    {
        if (context.JsonTypeInfo.Type == typeof(OptionalDateTimeOffset))
        {
            schema.Type = JsonSchemaType.String | JsonSchemaType.Null;
            schema.Format = "date-time";
        }
        else if (context.JsonTypeInfo.Type == typeof(OptionalString))
        {
            schema.Type = JsonSchemaType.String | JsonSchemaType.Null;
            schema.Format = null;
        }

        return Task.CompletedTask;
    }
}
