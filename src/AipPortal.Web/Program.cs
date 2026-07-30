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
using AipPortal.Web.Realtime;
using AipPortal.Web.Testing;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);
var browserSmokeSeedEnabled =
    builder.Configuration.GetValue<bool>("BrowserSmokeSeed:Enabled") ||
    builder.Configuration.GetValue<bool>("AIP_BROWSER_SMOKE_SEED_ENABLED");
var browserSmokeResponseGateEnabled =
    builder.Environment.IsEnvironment("Test") &&
    browserSmokeSeedEnabled &&
    builder.Configuration.GetValue<bool>("AIP_BROWSER_SMOKE_RESPONSE_GATE_ENABLED");

builder.Services
    .AddApplication()
    .AddInfrastructure(builder.Configuration)
    .AddWebServices(builder.Configuration);
if (browserSmokeResponseGateEnabled)
{
    builder.Services.AddSingleton<BrowserSmokeResponseGateRegistry>();
}

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
builder.Services.AddSignalR();
builder.Services.Configure<RealtimeOptions>(builder.Configuration.GetSection("Realtime"));
builder.Services.AddSingleton<HubSubscriptionRegistry>();
builder.Services.AddSingleton<RealtimeDiagnostics>();
builder.Services.AddSingleton<IRealtimeConnectionInvalidator, RealtimeConnectionInvalidator>();
builder.Services.AddScoped<IHubSubscriptionAuthorizer, HubSubscriptionAuthorizer>();
builder.Services.AddScoped<IRealtimeDispatchAuthorizer, RealtimeDispatchAuthorizer>();
builder.Services.AddHostedService<OutboxDispatcher>();
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
var bootstrapAdminEmail =
    builder.Configuration["AIP_BOOTSTRAP_ADMIN_EMAIL"] ??
    builder.Configuration["BootstrapAdmin:Email"];
if (tenancyOptions.SeedOnStartup ||
    tenancyOptions.AppMode == AppMode.OnPremSingleTenant ||
    builder.Configuration.GetValue<bool>("UiShell:SeedOnStartup") ||
    browserSmokeSeedEnabled ||
    seedAdminEnabled ||
    !string.IsNullOrWhiteSpace(bootstrapAdminEmail))
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
    else if (!string.IsNullOrWhiteSpace(bootstrapAdminEmail))
    {
        await AppDbContextSeed.EnsureBootstrapAdminAsync(
            dbContext,
            scope.ServiceProvider.GetRequiredService<IPasswordHasher>(),
            defaultTenant.Id,
            bootstrapAdminEmail,
            builder.Configuration["AIP_BOOTSTRAP_ADMIN_PASSWORD"],
            builder.Configuration["AIP_BOOTSTRAP_ADMIN_DISPLAY_NAME"] ?? builder.Configuration["BootstrapAdmin:DisplayName"]);
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

    if (browserSmokeSeedEnabled)
    {
        var smokeEmail =
            builder.Configuration["BrowserSmokeSeed:Email"] ??
            builder.Configuration["AIP_BROWSER_SMOKE_EMAIL"];
        var smokePassword =
            builder.Configuration["BrowserSmokeSeed:Password"] ??
            builder.Configuration["AIP_BROWSER_SMOKE_PASSWORD"];
        if (string.IsNullOrWhiteSpace(smokeEmail) || string.IsNullOrWhiteSpace(smokePassword))
        {
            throw new InvalidOperationException(
                "Browser smoke seed is enabled but BrowserSmokeSeed:Email or BrowserSmokeSeed:Password is missing.");
        }

        await AppDbContextSeed.SeedBrowserSmokeAsync(
            dbContext,
            scope.ServiceProvider.GetRequiredService<IPasswordHasher>(),
            scope.ServiceProvider.GetRequiredService<IFileStorageService>(),
            defaultTenant.Id,
            smokeEmail,
            smokePassword);
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
// SignalR upgrades its same-origin transport to WebSockets. Register the
// WebSocket middleware before authentication and endpoint execution so the
// Hub can establish the upgrade after a successful negotiate request.
app.UseWebSockets();
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
if (browserSmokeResponseGateEnabled)
{
    app.UseMiddleware<BrowserSmokeResponseGateMiddleware>();
}

app.MapControllers();
if (browserSmokeResponseGateEnabled)
{
    var responseGates = app.MapGroup("/internal/browser-smoke/response-gates")
        .RequireAuthorization();
    responseGates.MapPost("/{gateId}/arm", ArmBrowserSmokeResponseGate);
    responseGates.MapGet("/{gateId}", GetBrowserSmokeResponseGate);
    responseGates.MapPost("/{gateId}/release", ReleaseBrowserSmokeResponseGate);
}

// Runtime flags are loaded as a same-origin external script so the Angular
// bootstrap remains compatible with the production CSP (script-src 'self').
app.MapGet("/api/ui/runtime-config.js", async (
    IFeatureFlagService featureFlags,
    CancellationToken cancellationToken) =>
{
    var flags = new Dictionary<string, bool>(StringComparer.Ordinal)
    {
        ["realtime.signalR"] = await featureFlags.IsEnabledAsync(FeatureKeys.RealtimeSignalR, cancellationToken),
        ["tasks.kanbanV1"] = await featureFlags.IsEnabledAsync(FeatureKeys.KanbanV1, cancellationToken)
    };
    return Results.Text(
        $"window.__AIP_FEATURE_FLAGS__ = {JsonSerializer.Serialize(flags)};",
        "text/javascript; charset=utf-8");
});
app.MapHub<AppHub>("/hubs/app");

app.MapGet("/", () => Results.Redirect($"{AngularSpaFallback.AppRequestPath}/", permanent: false));

app.MapGet("/health", () => Results.Redirect("/health/ready", permanent: false));

app.MapGet("/health/live", () => Results.Ok(new { status = "OK" }));

app.MapGet("/health/realtime", async (
    AipPortal.Application.Realtime.IOutboxEventRepository outbox,
    ICurrentTenantAccessor currentTenant,
    RealtimeDiagnostics diagnostics,
    IOptions<RealtimeOptions> realtimeOptions,
    CancellationToken cancellationToken) =>
{
    currentTenant.SetPlatformScope();
    var configured = realtimeOptions.Value;
    var state = await outbox.GetDiagnosticsAsync(
        DateTimeOffset.UtcNow.AddSeconds(-Math.Max(1, configured.ProcessingLockSeconds)),
        cancellationToken);
    var counters = diagnostics.Snapshot();
    return Results.Ok(new
    {
        status = "OK",
        backlog = new
        {
            pending = state.PendingCount,
            retryScheduled = state.RetryScheduledCount,
            deadLetter = state.DeadLetterCount,
            oldestPendingAt = state.OldestPendingAt,
            staleProcessing = state.StaleProcessingCount
        },
        dispatcher = new
        {
            dispatchSuccess = counters.DispatchSuccessCount,
            dispatchFailure = counters.DispatchFailureCount,
            failures = counters.DispatcherFailureCount
        },
        subscriptions = new { denials = counters.SubscriptionDenialCount }
    });
});

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

static IResult ArmBrowserSmokeResponseGate(
    string gateId,
    BrowserSmokeResponseGateArmRequest request,
    BrowserSmokeResponseGateRegistry registry,
    ICurrentUser currentUser)
{
    if (!TryGetSyntheticBrowserSmokeActor(currentUser, out var actorUserId) ||
        !Guid.TryParseExact(gateId, "N", out var parsedGateId))
    {
        return Results.NotFound();
    }

    if (!BrowserSmokeResponseGateRegistry.IsAllowedTarget(request.Method, request.Path))
    {
        return Results.BadRequest(new { error = "Invalid response gate target." });
    }

    return registry.TryArm(parsedGateId, actorUserId, request.Method, request.Path)
        ? Results.Ok(new { state = "armed" })
        : Results.Conflict(new { error = "A response gate is already active." });
}

static IResult GetBrowserSmokeResponseGate(
    string gateId,
    BrowserSmokeResponseGateRegistry registry,
    ICurrentUser currentUser)
{
    if (!TryGetSyntheticBrowserSmokeActor(currentUser, out var actorUserId) ||
        !Guid.TryParseExact(gateId, "N", out var parsedGateId))
    {
        return Results.NotFound();
    }

    var snapshot = registry.GetSnapshot(parsedGateId, actorUserId);
    return snapshot is null
        ? Results.NotFound()
        : Results.Ok(snapshot);
}

static IResult ReleaseBrowserSmokeResponseGate(
    string gateId,
    BrowserSmokeResponseGateRegistry registry,
    ICurrentUser currentUser)
{
    if (!TryGetSyntheticBrowserSmokeActor(currentUser, out var actorUserId) ||
        !Guid.TryParseExact(gateId, "N", out var parsedGateId) ||
        !registry.TryRelease(parsedGateId, actorUserId))
    {
        return Results.NotFound();
    }

    return Results.Ok(new { state = "released" });
}

static bool TryGetSyntheticBrowserSmokeActor(ICurrentUser currentUser, out Guid actorUserId)
{
    actorUserId = currentUser.UserId ?? Guid.Empty;
    return currentUser.IsAuthenticated &&
           actorUserId != Guid.Empty &&
           currentUser.Email?.EndsWith("@example.test", StringComparison.OrdinalIgnoreCase) == true;
}

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
