using AipPortal.Application;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure;
using AipPortal.Infrastructure.Files;
using AipPortal.Infrastructure.Persistence;
using AipPortal.Web;
using AipPortal.Web.Configuration;
using AipPortal.Web.Extensions;
using AipPortal.Web.Middleware;
using AipPortal.Web.Models;
using AipPortal.Web.Security;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
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
        options.EventsType = typeof(DbSessionCookieAuthenticationEvents);
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

if (ForwardedHeadersConfiguration.ShouldTrustForwardedHeaders(builder.Configuration))
{
    builder.Services.Configure<ForwardedHeadersOptions>(ForwardedHeadersConfiguration.Configure);
}

var app = builder.Build();

if (ForwardedHeadersConfiguration.ShouldTrustForwardedHeaders(app.Configuration))
{
    app.UseForwardedHeaders();
}

app.UseMiddleware<GlobalExceptionHandlingMiddleware>();
app.UseMiddleware<SecurityHeadersMiddleware>();

var tenancyOptions = app.Services.GetRequiredService<TenancyOptions>();
var seedAdminEnabled = builder.Configuration.GetValue<bool>("AIP_SEED_ADMIN_ENABLED");
if (tenancyOptions.SeedOnStartup ||
    tenancyOptions.AppMode == AppMode.OnPremSingleTenant ||
    builder.Configuration.GetValue<bool>("UiShell:SeedOnStartup") ||
    seedAdminEnabled)
{
    await using var scope = app.Services.CreateAsyncScope();
    var currentTenant = scope.ServiceProvider.GetRequiredService<ICurrentTenantAccessor>();
    currentTenant.SetPlatformScope();
    var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var defaultTenant = await AppDbContextSeed.SeedDefaultTenantAsync(dbContext, tenancyOptions);
    await AppDbContextSeed.SeedPlansAsync(dbContext);
    if (seedAdminEnabled)
    {
        var seedAdminEmail = builder.Configuration["AIP_SEED_ADMIN_EMAIL"];
        var seedAdminUsername = builder.Configuration["AIP_SEED_ADMIN_USERNAME"];
        var seedAdminPassword = builder.Configuration["AIP_SEED_ADMIN_PASSWORD"];
        if (string.IsNullOrWhiteSpace(seedAdminEmail) ||
            string.IsNullOrWhiteSpace(seedAdminUsername) ||
            string.IsNullOrWhiteSpace(seedAdminPassword))
        {
            throw new InvalidOperationException(
                "AIP seed admin is enabled but AIP_SEED_ADMIN_EMAIL, AIP_SEED_ADMIN_USERNAME, or AIP_SEED_ADMIN_PASSWORD is missing.");
        }

        await AppDbContextSeed.SeedLocalAdminAsync(
            dbContext,
            scope.ServiceProvider.GetRequiredService<IPasswordHasher>(),
            defaultTenant.Id,
            seedAdminEmail,
            seedAdminPassword,
            seedAdminUsername);
    }
    else if (app.Environment.IsDevelopment() && builder.Configuration.GetValue<bool>("LocalAdmin:SeedOnStartup"))
    {
        var localAdminPassword = builder.Configuration["LocalAdmin:Password"];
        if (string.IsNullOrWhiteSpace(localAdminPassword))
        {
            throw new InvalidOperationException("LocalAdmin:Password is required when LocalAdmin:SeedOnStartup is enabled.");
        }

        await AppDbContextSeed.SeedLocalAdminAsync(
            dbContext,
            scope.ServiceProvider.GetRequiredService<IPasswordHasher>(),
            defaultTenant.Id,
            builder.Configuration["LocalAdmin:Email"] ?? "admin@example.com",
            localAdminPassword,
            builder.Configuration["LocalAdmin:DisplayName"] ?? "Local Admin");
    }

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
    app.UseWhen(
        context => !context.Request.Path.StartsWithSegments("/health"),
        branch => branch.UseHttpsRedirection());
}

var webRootPath = app.Environment.WebRootPath ?? Path.Combine(app.Environment.ContentRootPath, "wwwroot");

app.Use(async (context, next) =>
{
    if ((AngularSpaFallback.IsAppPath(context.Request.Path) || AngularSpaFallback.IsAngularIndexPath(context.Request.Path)) &&
        !AngularSpaFallback.HasAngularBuild(webRootPath))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }

    await next();
});

app.UseStaticFiles(new StaticFileOptions
{
    RequestPath = AngularSpaFallback.AppRequestPath,
    OnPrepareResponse = context =>
        AngularSpaFallback.ApplyStaticFileHeaders(context.Context.Response, context.Context.Request.Path)
});

app.UseMiddleware<TenantResolutionMiddleware>();
if (securityOptions.EnableRateLimiting)
{
    app.UseRateLimiter();
}
app.UseAuthentication();
if (securityOptions.EnableCsrfProtection)
{
    app.Services.GetRequiredService<CsrfProtectionState>().MarkMiddlewareActive();
    app.UseMiddleware<CsrfProtectionMiddleware>();
}
app.UseAuthorization();

app.MapControllers();

app.MapGet("/", () => Results.Redirect($"{AngularSpaFallback.AppRequestPath}/", permanent: false));

app.MapGet("/health", () => Results.Redirect("/health/ready", permanent: false));

app.MapGet("/health/live", () => Results.Ok(new { status = "OK" }));

app.MapGet("/favicon.ico", () => Results.NoContent());

app.MapGet("/health/ready", async (
    AppDbContext dbContext,
    IOptions<FileStorageOptions> fileStorageOptions,
    TenancyOptions tenancyOptions,
    IConfiguration configuration,
    CancellationToken cancellationToken) =>
{
    var databaseOk = await IsDatabaseReadyAsync(dbContext, cancellationToken);
    var migrationsOk = databaseOk && await AreMigrationsReadyAsync(dbContext, cancellationToken);
    var storageOk = await IsFileStorageReadyAsync(fileStorageOptions.Value, cancellationToken);
    var dataProtectionOk = IsDataProtectionReady(configuration);
    var defaultTenantOk = databaseOk && await IsDefaultTenantReadyAsync(dbContext, tenancyOptions, cancellationToken);
    var ready = databaseOk && migrationsOk && storageOk && dataProtectionOk && defaultTenantOk;

    return ready
        ? Results.Ok(new { status = "OK", checks = new { database = "OK", migrations = "OK", fileStorage = "OK", dataProtection = "OK", defaultTenant = "OK" } })
        : Results.Json(new { status = "Unhealthy" }, statusCode: StatusCodes.Status503ServiceUnavailable);
});

app.MapFallback(context => AngularSpaFallback.HandleAsync(context, webRootPath));

app.Run();

static async Task<bool> IsDatabaseReadyAsync(AppDbContext dbContext, CancellationToken cancellationToken)
{
    try
    {
        return await dbContext.Database.CanConnectAsync(cancellationToken);
    }
    catch
    {
        return false;
    }
}

static async Task<bool> AreMigrationsReadyAsync(AppDbContext dbContext, CancellationToken cancellationToken)
{
    try
    {
        var pendingMigrations = await dbContext.Database.GetPendingMigrationsAsync(cancellationToken);
        return !pendingMigrations.Any();
    }
    catch
    {
        return false;
    }
}

static async Task<bool> IsFileStorageReadyAsync(FileStorageOptions options, CancellationToken cancellationToken)
{
    try
    {
        return options.Provider switch
        {
            "LocalFileSystem" => await IsLocalFileStorageReadyAsync(options.RootPath, cancellationToken),
            "ObjectStorage" or "S3Compatible" or "OCIObjectStorage" => false,
            _ => false
        };
    }
    catch
    {
        return false;
    }
}

static async Task<bool> IsLocalFileStorageReadyAsync(string rootPath, CancellationToken cancellationToken)
{
    if (string.IsNullOrWhiteSpace(rootPath))
    {
        return false;
    }

    var fullPath = Path.GetFullPath(rootPath);
    Directory.CreateDirectory(fullPath);
    var probePath = Path.Combine(fullPath, $".health-{Guid.NewGuid():N}");
    try
    {
        await File.WriteAllTextAsync(probePath, "OK", cancellationToken);
        return true;
    }
    finally
    {
        File.Delete(probePath);
    }
}

static bool IsDataProtectionReady(IConfiguration configuration)
{
    var keysPath = configuration["DataProtection:KeysPath"];
    if (string.IsNullOrWhiteSpace(keysPath))
    {
        return true;
    }

    try
    {
        var fullPath = Path.GetFullPath(keysPath);
        Directory.CreateDirectory(fullPath);
        var probePath = Path.Combine(fullPath, $".health-{Guid.NewGuid():N}");
        File.WriteAllText(probePath, "OK");
        File.Delete(probePath);
        return true;
    }
    catch
    {
        return false;
    }
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

    try
    {
        var slug = tenancyOptions.DefaultTenantSlug.Trim().ToLowerInvariant();
        return await dbContext.Tenants.AnyAsync(tenant => tenant.Slug == slug && tenant.Status == TenantStatus.Active, cancellationToken);
    }
    catch
    {
        return false;
    }
}
