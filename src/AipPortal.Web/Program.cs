using AipPortal.Application;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure;
using AipPortal.Infrastructure.Files;
using AipPortal.Infrastructure.Persistence;
using AipPortal.Web.Configuration;
using AipPortal.Web.Extensions;
using AipPortal.Web.Middleware;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddApplication()
    .AddInfrastructure(builder.Configuration)
    .AddWebServices(builder.Configuration);

var dataProtectionKeysPath = builder.Configuration["DataProtection:KeysPath"];
if (!string.IsNullOrWhiteSpace(dataProtectionKeysPath))
{
    var keysDirectory = Path.GetFullPath(dataProtectionKeysPath);
    Directory.CreateDirectory(keysDirectory);
    builder.Services.AddDataProtection()
        .PersistKeysToFileSystem(new DirectoryInfo(keysDirectory));
}

builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        var security = builder.Configuration.GetSection("Security").Get<SecurityOptions>() ?? new SecurityOptions();
        options.Cookie.Name = ".AipPortal.Auth";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = security.CookieSecurePolicy;
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.SlidingExpiration = true;
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        };
    });

builder.Services.AddAuthorization();
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddFixedWindowLimiter("login", limiter =>
    {
        limiter.PermitLimit = 10;
        limiter.Window = TimeSpan.FromMinutes(1);
        limiter.QueueLimit = 0;
    });
    options.AddFixedWindowLimiter("invite", limiter =>
    {
        limiter.PermitLimit = 10;
        limiter.Window = TimeSpan.FromMinutes(1);
        limiter.QueueLimit = 0;
    });
    options.AddFixedWindowLimiter("file-upload", limiter =>
    {
        limiter.PermitLimit = 20;
        limiter.Window = TimeSpan.FromMinutes(1);
        limiter.QueueLimit = 0;
    });
    options.AddFixedWindowLimiter("api-token", limiter =>
    {
        limiter.PermitLimit = 30;
        limiter.Window = TimeSpan.FromMinutes(1);
        limiter.QueueLimit = 0;
    });
    options.AddFixedWindowLimiter("search", limiter =>
    {
        limiter.PermitLimit = 60;
        limiter.Window = TimeSpan.FromMinutes(1);
        limiter.QueueLimit = 0;
    });
});

var app = builder.Build();

app.UseMiddleware<GlobalExceptionHandlingMiddleware>();
app.UseMiddleware<SecurityHeadersMiddleware>();

var tenancyOptions = app.Services.GetRequiredService<TenancyOptions>();
if (tenancyOptions.SeedOnStartup || tenancyOptions.AppMode == AppMode.OnPremSingleTenant || builder.Configuration.GetValue<bool>("UiShell:SeedOnStartup"))
{
    await using var scope = app.Services.CreateAsyncScope();
    var currentTenant = scope.ServiceProvider.GetRequiredService<ICurrentTenantAccessor>();
    currentTenant.SetPlatformScope();
    var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var defaultTenant = await AppDbContextSeed.SeedDefaultTenantAsync(dbContext, tenancyOptions);
    await AppDbContextSeed.SeedPlansAsync(dbContext);
    if (builder.Configuration.GetValue<bool>("UiShell:SeedOnStartup"))
    {
        await AppDbContextSeed.SeedUiShellAsync(dbContext, defaultTenant.Id);
    }
}

var securityOptions = app.Services.GetRequiredService<IOptions<SecurityOptions>>().Value;
if (securityOptions.EnableHsts && !app.Environment.IsDevelopment())
{
    app.UseHsts();
}

if (securityOptions.RequireHttps)
{
    app.UseHttpsRedirection();
}

app.UseDefaultFiles();
app.UseStaticFiles();

app.UseMiddleware<TenantResolutionMiddleware>();
if (securityOptions.EnableRateLimiting)
{
    app.UseRateLimiter();
}
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.MapGet("/health", async (AppDbContext dbContext, CancellationToken cancellationToken) =>
{
    var databaseOk = await dbContext.Database.CanConnectAsync(cancellationToken);
    return databaseOk
        ? Results.Ok(new { status = "OK", database = "OK" })
        : Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
});

app.MapGet("/health/live", () => Results.Ok(new { status = "OK" }));

app.MapGet("/health/ready", async (
    AppDbContext dbContext,
    IOptions<FileStorageOptions> fileStorageOptions,
    TenancyOptions tenancyOptions,
    CancellationToken cancellationToken) =>
{
    var databaseOk = await dbContext.Database.CanConnectAsync(cancellationToken);
    var storageOk = IsFileStorageReady(fileStorageOptions.Value);
    var defaultTenantOk = await IsDefaultTenantReadyAsync(dbContext, tenancyOptions, cancellationToken);
    var ready = databaseOk && storageOk && defaultTenantOk;

    return ready
        ? Results.Ok(new { status = "OK", database = "OK", fileStorage = "OK", defaultTenant = "OK" })
        : Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
});

app.MapFallback(async context =>
{
    if (context.Request.Path.StartsWithSegments("/api"))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        await context.Response.WriteAsJsonAsync(new { error = "Endpoint not found." });
        return;
    }

    var indexPath = Path.Combine(app.Environment.WebRootPath, "index.html");
    context.Response.ContentType = "text/html; charset=utf-8";
    await context.Response.SendFileAsync(indexPath);
});

app.Run();

static bool IsFileStorageReady(FileStorageOptions options)
{
    return options.Provider switch
    {
        "LocalFileSystem" => !string.IsNullOrWhiteSpace(options.RootPath) && Directory.Exists(Path.GetFullPath(options.RootPath)),
        "ObjectStorage" or "S3Compatible" or "OCIObjectStorage" => !string.IsNullOrWhiteSpace(options.BucketName),
        _ => false
    };
}

static async Task<bool> IsDefaultTenantReadyAsync(AppDbContext dbContext, TenancyOptions tenancyOptions, CancellationToken cancellationToken)
{
    if (tenancyOptions.AppMode != AppMode.OnPremSingleTenant)
    {
        return true;
    }

    if (string.IsNullOrWhiteSpace(tenancyOptions.DefaultTenantSlug))
    {
        return false;
    }

    var slug = tenancyOptions.DefaultTenantSlug.Trim().ToLowerInvariant();
    return await dbContext.Tenants.AnyAsync(tenant => tenant.Slug == slug && tenant.Status == TenantStatus.Active, cancellationToken);
}
