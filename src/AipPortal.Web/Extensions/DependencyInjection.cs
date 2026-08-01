using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Application.Auth;
using AipPortal.Application.Messaging;
using AipPortal.Web.Configuration;
using AipPortal.Web.Security;
using AipPortal.Web.Services;
using Microsoft.AspNetCore.Mvc;
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
        services.AddScoped<ITenantResolver, HttpTenantResolver>();
        services.AddControllers()
            .ConfigureApiBehaviorOptions(options =>
            {
                var defaultFactory = options.InvalidModelStateResponseFactory;
                options.InvalidModelStateResponseFactory = context =>
                {
                    var path = context.HttpContext.Request.Path.Value;
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

    private static string NormalizePath(string? path) =>
        path?.TrimEnd('/') ?? string.Empty;
}
