using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Application.Auth;
using AipPortal.Web.Configuration;
using AipPortal.Web.Security;
using AipPortal.Web.Services;
using Microsoft.Extensions.Options;

namespace AipPortal.Web.Extensions;

public static class DependencyInjection
{
    public static IServiceCollection AddWebServices(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<TenancyOptions>(configuration.GetSection("Tenancy"));
        services.Configure<SecurityOptions>(configuration.GetSection("Security"));
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
        services.AddControllers();
        return services;
    }
}
