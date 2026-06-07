using AipPortal.Application;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure;
using AipPortal.Infrastructure.Persistence;
using AipPortal.Web.Configuration;
using AipPortal.Web.Extensions;
using AipPortal.Web.Middleware;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddApplication()
    .AddInfrastructure(builder.Configuration)
    .AddWebServices(builder.Configuration);

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

var app = builder.Build();

app.UseMiddleware<GlobalExceptionHandlingMiddleware>();

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

app.MapGet("/health/ready", async (AppDbContext dbContext, CancellationToken cancellationToken) =>
{
    var databaseOk = await dbContext.Database.CanConnectAsync(cancellationToken);
    return databaseOk
        ? Results.Ok(new { status = "OK", database = "OK" })
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
    await context.Response.SendFileAsync(indexPath);
});

app.Run();
