using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Web.Configuration;
using AipPortal.Web.Services;
using Microsoft.Extensions.Options;

namespace AipPortal.Web.Extensions;

public static class DependencyInjection
{
    public static IServiceCollection AddWebServices(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<TenancyOptions>(configuration.GetSection("Tenancy"));
        services.Configure<SecurityOptions>(configuration.GetSection("Security"));
        services.Configure<PlatformOptions>(configuration.GetSection("Platform"));
        services.Configure<FeatureOptions>(configuration.GetSection("Features"));
        services.AddSingleton(provider => provider.GetRequiredService<IOptions<TenancyOptions>>().Value);
        services.AddHostedService<StartupConfigurationValidator>();
        services.AddHttpContextAccessor();
        services.AddScoped<ICurrentUser, CurrentUserService>();
        services.AddScoped<ITenantResolver, HttpTenantResolver>();
        services.AddControllers();
        return services;
    }
}
