using Microsoft.Extensions.DependencyInjection;
using AipPortal.Application.Auth;

namespace AipPortal.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddScoped<IAuthService, AuthService>();
        return services;
    }
}
