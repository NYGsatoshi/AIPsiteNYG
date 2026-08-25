using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Application.Auth;
using AipPortal.Application.Messaging;
using AipPortal.Application.Notifications;
using AipPortal.Application.Security.Redaction;
using AipPortal.Infrastructure.Persistence;
using AipPortal.Web.Configuration;
using AipPortal.Web.Security;
using AipPortal.Web.Services;
using AipPortal.Web.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace AipPortal.Web.Extensions;

public static class DependencyInjection
{
    public static IServiceCollection AddWebServices(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<TenancyOptions>(configuration.GetSection("Tenancy"));
        services.Configure<SecurityOptions>(configuration.GetSection("Security"));
        services.AddSingleton(configuration.GetSection("CommunicationSafety").Get<CommunicationSafetyOptions>() ?? new CommunicationSafetyOptions());
        services.AddSingleton(configuration.GetSection("Security").Get<AuthSecurityOptions>() ?? new AuthSecurityOptions());
        services.Configure<PlatformOptions>(configuration.GetSection("Platform"));
        services.Configure<FeatureOptions>(configuration.GetSection("Features"));
        services.AddSingleton(provider => provider.GetRequiredService<IOptions<TenancyOptions>>().Value);
        services.AddSingleton<CsrfProtectionState>();
        services.AddAntiforgery(options =>
        {
            var security = configuration.GetSection("Security").Get<SecurityOptions>() ?? new SecurityOptions();
            options.HeaderName = SecurityOptions.CsrfHeaderName;
            options.Cookie.Name = ".AipPortal.Csrf";
            options.Cookie.HttpOnly = true;
            options.Cookie.SameSite = SameSiteMode.Lax;
            options.Cookie.SecurePolicy = security.CookieSecurePolicy;
        });
        services.AddHostedService<StartupConfigurationValidator>();
        services.AddHttpContextAccessor();
        services.AddScoped<ICurrentUser, CurrentUserService>();
        services.AddScoped<DbSessionCookieAuthenticationEvents>();
        services.AddSingleton<IAuthorizationMiddlewareResultHandler, WpcAuthorizationMiddlewareResultHandler>();
        services.AddScoped<ITenantResolver, HttpTenantResolver>();

        // Message notification settings are tenant/user scoped. Replace the
        // generic persistence service at the Web composition root so all
        // Message notification creation passes through the preference policy.
        services.AddScoped<IMessageNotificationPreferenceStore, MessageNotificationPreferenceStore>();
        services.AddScoped<IMessageNotificationPreferenceService, MessageNotificationPreferenceService>();
        services.AddScoped<DbNotificationService>();
        services.Replace(ServiceDescriptor.Scoped<INotificationService, PreferenceAwareNotificationService>());

        services.AddControllers(options =>
            options.Filters.Add<CanonicalProjectsResponseProjectionFilter>())
            .ConfigureApiBehaviorOptions(options =>
            {
                var defaultFactory = options.InvalidModelStateResponseFactory;
                options.InvalidModelStateResponseFactory = context =>
                {
                    var path = context.HttpContext.Request.Path.Value;
                    if (IsWpcCreatePath(path, context.HttpContext.Request.Method))
                    {
                        if (context.HttpContext.User.Identity?.IsAuthenticated != true)
                        {
                            return new UnauthorizedObjectResult(ApiEnvelope.Error(
                                context.HttpContext,
                                StatusCodes.Status401Unauthorized,
                                "AuthenticationRequired",
                                "Authentication is required."));
                        }

                        var malformedJson = context.ModelState.Any(entry =>
                            string.Equals(entry.Key, "$", StringComparison.Ordinal) &&
                            entry.Value?.Errors.Any(error =>
                                !error.ErrorMessage.Contains("could not be converted", StringComparison.OrdinalIgnoreCase)) == true);
                        var unsupportedMediaType = context.ModelState.Values
                            .SelectMany(value => value.Errors)
                            .Any(error => string.Equals(
                                error.Exception?.GetType().Name,
                                "UnsupportedContentTypeException",
                                StringComparison.Ordinal));
                        if (unsupportedMediaType)
                        {
                            return new ObjectResult(ApiEnvelope.Error(
                                context.HttpContext,
                                StatusCodes.Status415UnsupportedMediaType,
                                "UnsupportedMediaType",
                                "The request Content-Type is not supported.",
                                "header.Content-Type"))
                            {
                                StatusCode = StatusCodes.Status415UnsupportedMediaType
                            };
                        }
                        return new BadRequestObjectResult(ApiEnvelope.Error(
                            context.HttpContext,
                            StatusCodes.Status400BadRequest,
                            malformedJson ? "MalformedJson" : "ValidationFailed",
                            malformedJson
                                ? "The request body is not valid JSON."
                                : "The request body or parameters are invalid.",
                            "body"));
                    }
                    if (!IsPr06CommandPath(path))
                        return defaultFactory(context);

                    var dependency = path?.Contains("/dependencies", StringComparison.OrdinalIgnoreCase) == true;
                    if (context.HttpContext.User.Identity?.IsAuthenticated != true)
                    {
                        return new UnauthorizedObjectResult(new
                        {
                            requestId = context.HttpContext.TraceIdentifier,
                            error = new
                            {
                                code = dependency
                                    ? "TASK_DEPENDENCY_AUTHENTICATION_REQUIRED"
                                    : "GANTT_AUTHENTICATION_REQUIRED",
                                message = "Authentication is required.",
                                target = (string?)null,
                                details = Array.Empty<object>(),
                                redactionApplied = false
                            }
                        });
                    }

                    return new BadRequestObjectResult(new
                    {
                        requestId = context.HttpContext.TraceIdentifier,
                        error = new
                        {
                            code = dependency ? "TASK_DEPENDENCY_INVALID_REQUEST" : "GANTT_INVALID_REQUEST",
                            message = "The request body or parameters are invalid.",
                            target = (string?)null,
                            details = Array.Empty<object>(),
                            redactionApplied = false
                        }
                    });
                };
            });
        return services;
    }

    private static bool IsPr06CommandPath(string? path) =>
        NormalizePath(path).StartsWith("/api/tasks/", StringComparison.OrdinalIgnoreCase) &&
        (NormalizePath(path).EndsWith("/schedule", StringComparison.OrdinalIgnoreCase) ||
         NormalizePath(path).EndsWith("/progress", StringComparison.OrdinalIgnoreCase) ||
         NormalizePath(path).Contains("/dependencies", StringComparison.OrdinalIgnoreCase));

    private static bool IsWpcCreatePath(string? path, string method) =>
        HttpMethods.IsPost(method) && ApiEnvelope.IsCanonicalCreatePath(path);

    private static string NormalizePath(string? path) =>
        path?.TrimEnd('/') ?? string.Empty;
}
