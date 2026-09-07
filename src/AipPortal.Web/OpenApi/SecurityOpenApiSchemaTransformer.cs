using System.ComponentModel.DataAnnotations;
using System.Reflection;
using System.Text.Json.Nodes;
using AipPortal.Application.Announcements;
using AipPortal.Application.Events;
using AipPortal.Application.Messaging;
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
        // Preserve validation metadata on record properties as well as
        // constructor parameters. Required strings must not generate blanks.
        foreach (var property in context.JsonTypeInfo.Type.GetProperties())
        {
            var name = context.JsonTypeInfo.Options.PropertyNamingPolicy?.ConvertName(property.Name) ?? property.Name;
            if (schema.Properties?.TryGetValue(name, out var value) != true || value is not OpenApiSchema field)
                continue;
            if (property.PropertyType == typeof(string) &&
                property.GetCustomAttribute<RequiredAttribute>() is { AllowEmptyStrings: false })
                ConfigureNonBlankString(schema, name, field.MaxLength);
            if (property.GetCustomAttribute<RegularExpressionAttribute>() is { } pattern)
                field.Pattern = pattern.Pattern;
            if (property.GetCustomAttribute<MinLengthAttribute>() is { } minimum)
                field.MinLength = Math.Max(field.MinLength ?? 0, minimum.Length);
            if (property.GetCustomAttribute<EmailAddressAttribute>() is not null)
                field.Format = "email";
        }

        if (context.JsonTypeInfo.Type == typeof(CreateConversationRequest))
        {
            schema.OneOf =
            [
                ConversationScope("DirectMessage", "workspaceId"),
                ConversationScope("ProjectChannel", "workspaceId", "projectId"),
                ConversationScope("Thread", "parentConversationId")
            ];
        }
        else if (context.JsonTypeInfo.Type == typeof(CreateEventRequest))
        {
            ConfigureNonBlankString(schema, "title");
            var scopes = new[] { "workspaceId", "groupId", "projectId" };
            schema.OneOf = scopes.Select(selected => (IOpenApiSchema)new OpenApiSchema
            {
                Required = new HashSet<string> { selected },
                Properties = scopes.ToDictionary(name => name, name => (IOpenApiSchema)(name == selected
                    ? new OpenApiSchema { Type = JsonSchemaType.String, Format = "uuid" }
                    : new OpenApiSchema { Type = JsonSchemaType.Null }))
            }).ToList();
        }

        if (context.JsonTypeInfo.Type == typeof(IFormFile))
        {
            schema.MinLength = 1;
        }
        else if (context.JsonTypeInfo.Type == typeof(OptionalDateTimeOffset))
        {
            schema.Type = JsonSchemaType.String | JsonSchemaType.Null;
            schema.Format = "date-time";
        }
        else if (context.JsonTypeInfo.Type == typeof(OptionalString))
        {
            schema.Type = JsonSchemaType.String | JsonSchemaType.Null;
            schema.Format = null;
        }
        else if (context.JsonTypeInfo.Type == typeof(CreateAnnouncementRequest) ||
                 context.JsonTypeInfo.Type == typeof(UpdateAnnouncementRequest))
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

    private static OpenApiSchema ConversationScope(string type, params string[] requiredIds)
    {
        var properties = requiredIds.ToDictionary(name => name, _ => (IOpenApiSchema)new OpenApiSchema
        {
            Type = JsonSchemaType.String,
            Format = "uuid",
            Not = new OpenApiSchema { Enum = [JsonValue.Create(Guid.Empty.ToString())!] }
        });
        properties["type"] = new OpenApiSchema { Enum = [JsonValue.Create(type)!] };
        return new OpenApiSchema
        {
            Required = requiredIds.Append("type").ToHashSet(),
            Properties = properties
        };
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
        urlSchema.Pattern = "^(?:/(?!/)(?!\\.\\.(?:/|$))(?!.*?/\\.\\.(?:/|$))[^\\s\\\\]*|[hH][tT][tT][pP][sS]://[^\\s/:?#@\\\\][^\\s/?#@\\\\]*(?:[/?#][^\\s\\\\]*)?)$";
    }
}
