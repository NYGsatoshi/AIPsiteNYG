using Microsoft.AspNetCore.Http;

namespace AipPortal.Web.Configuration;

public sealed class SecurityOptions
{
    public const string CsrfHeaderName = "X-CSRF-TOKEN";

    public CookieSecurePolicy CookieSecurePolicy { get; set; } = CookieSecurePolicy.Always;

    public bool RequireHttps { get; set; } = true;

    public bool EnableHsts { get; set; } = true;

    public bool EnableCsrfProtection { get; set; } = true;

    public bool EnableRateLimiting { get; set; } = true;

    public bool LoginLockoutEnabled { get; set; } = true;

    public int MaxFailedLoginAttempts { get; set; } = 5;

    public int LoginLockoutDurationMinutes { get; set; } = 15;
}
