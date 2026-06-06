using AipPortal.Application.Common.Interfaces;
using AipPortal.Web.Services;

namespace AipPortal.Web.Extensions;

public static class DependencyInjection
{
    public static IServiceCollection AddWebServices(this IServiceCollection services)
    {
        services.AddHttpContextAccessor();
        services.AddScoped<ICurrentUser, CurrentUserService>();
        services.AddControllers();
        return services;
    }
}
