using AipPortal.Application.Announcements;
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
        else if (context.JsonTypeInfo.Type == typeof(CreateAnnouncementRequest))
        {
            // AnnouncementService and AnnouncementContentContract trim before
            // rejecting blank values; advertise that constraint to API scanners.
            ConfigureNonBlankString(schema, "title");
            ConfigureNonBlankString(schema, "body");
        }
        else if (context.JsonTypeInfo.Type == typeof(AnnouncementActionLink))
        {
            // A present action must be complete and safe; null remains the
            // representation for an omitted CTA or attachment.
            ConfigureNonBlankString(schema, "label", AnnouncementContentContract.MaximumLabelLength);
            ConfigureSafeActionUrl(schema);
        }

        return Task.CompletedTask;
    }

    private static void ConfigureNonBlankString(OpenApiSchema schema, string propertyName, int? maximumLength = null)
    {
        if (schema.Properties?.TryGetValue(propertyName, out var property) != true ||
            property is not OpenApiSchema stringSchema)
        {
            return;
        }

        stringSchema.MinLength = 1;
        stringSchema.Pattern = "[\\s\\S]*\\S[\\s\\S]*";
        stringSchema.MaxLength = maximumLength;
    }

    private static void ConfigureSafeActionUrl(OpenApiSchema schema)
    {
        if (schema.Properties?.TryGetValue("url", out var property) != true ||
            property is not OpenApiSchema urlSchema)
        {
            return;
        }

        urlSchema.MinLength = 1;
        urlSchema.MaxLength = AnnouncementContentContract.MaximumUrlLength;
        urlSchema.Pattern = "^(?:/(?!/)(?!\\.\\.(?:/|$))(?!.*?/\\.\\.(?:/|$))[^\\s\\\\]+|https://(?![^\\s/]*@)[^\\s/]+(?:/[^\\s\\\\]*)?)$";
    }
}
