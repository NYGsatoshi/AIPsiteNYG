using AipPortal.Application.Common.Tenancy;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Files;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;

namespace AipPortal.Web.Configuration;

public sealed class StartupConfigurationValidator(
    IOptions<TenancyOptions> tenancyOptions,
    IOptions<FileStorageOptions> fileStorageOptions,
    IOptions<SecurityOptions> securityOptions,
    IOptions<PlatformOptions> platformOptions,
    IWebHostEnvironment environment,
    ILogger<StartupConfigurationValidator> logger) : IHostedService
{
    public Task StartAsync(CancellationToken cancellationToken)
    {
        var errors = Validate();
        if (errors.Count > 0)
        {
            foreach (var error in errors)
            {
                logger.LogError("Configuration validation failed: {Error}", error);
            }

            throw new InvalidOperationException("AIP Portal configuration validation failed: " + string.Join(" | ", errors));
        }

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        var tenancy = tenancyOptions.Value;
        var fileStorage = fileStorageOptions.Value;
        var security = securityOptions.Value;
        var platform = platformOptions.Value;
        var isProduction = environment.IsProduction();

        if (!Enum.IsDefined(tenancy.AppMode))
        {
            errors.Add("Tenancy:AppMode must be one of SaaS, OnPremSingleTenant, or OnPremMultiTenant.");
        }

        if (!Enum.IsDefined(tenancy.TenantResolutionStrategy))
        {
            errors.Add("Tenancy:TenantResolutionStrategy is not valid.");
        }

        if (tenancy.AppMode == AppMode.OnPremSingleTenant && string.IsNullOrWhiteSpace(tenancy.DefaultTenantSlug))
        {
            errors.Add("Tenancy:DefaultTenantSlug is required for OnPremSingleTenant.");
        }

        if (isProduction &&
            tenancy.TenantResolutionStrategy == TenantResolutionStrategy.HeaderForDevelopmentOnly &&
            !tenancy.AllowDevelopmentHeaderInProduction)
        {
            errors.Add("Development header tenant resolution is disabled in production unless explicitly allowed.");
        }

        if (tenancy.TenantResolutionStrategy == TenantResolutionStrategy.HeaderForDevelopmentOnly &&
            !tenancy.AllowDevelopmentHeaderTenantResolution)
        {
            errors.Add("Tenancy:AllowDevelopmentHeaderTenantResolution must be true when using HeaderForDevelopmentOnly.");
        }

        if (isProduction && tenancy.AllowDevelopmentHeaderInProduction)
        {
            errors.Add("Tenancy:AllowDevelopmentHeaderInProduction must be false for production deployments.");
        }

        if (fileStorage.MaxFileSizeBytes <= 0)
        {
            errors.Add("FileStorage:MaxFileSizeBytes must be positive.");
        }

        if (fileStorage.AllowedExtensions.Length == 0)
        {
            errors.Add("FileStorage:AllowedExtensions must contain at least one extension.");
        }

        foreach (var extension in fileStorage.AllowedExtensions)
        {
            if (string.IsNullOrWhiteSpace(extension) || !extension.StartsWith(".", StringComparison.Ordinal))
            {
                errors.Add($"FileStorage:AllowedExtensions contains invalid extension '{extension}'.");
            }
        }

        switch (fileStorage.Provider)
        {
            case "LocalFileSystem":
                ValidateLocalFileSystem(errors, fileStorage);
                break;
            case "ObjectStorage":
            case "S3Compatible":
            case "OCIObjectStorage":
                ValidateObjectStorage(errors, fileStorage);
                break;
            default:
                errors.Add($"FileStorage:Provider '{fileStorage.Provider}' is not supported.");
                break;
        }

        if (isProduction)
        {
            if (security.CookieSecurePolicy != CookieSecurePolicy.Always)
            {
                errors.Add("Security:CookieSecurePolicy must be Always in production.");
            }

            if (!security.RequireHttps)
            {
                errors.Add("Security:RequireHttps must be true in production.");
            }

            if (!security.EnableHsts)
            {
                errors.Add("Security:EnableHsts must be true in production.");
            }

            if (platform.PlatformAdminSetupMode)
            {
                errors.Add("Platform:PlatformAdminSetupMode must not be enabled in production.");
            }
        }

        if (security.LoginLockoutEnabled && security.MaxFailedLoginAttempts <= 0)
        {
            errors.Add("Security:MaxFailedLoginAttempts must be positive when lockout is enabled.");
        }

        return errors;
    }

    private static void ValidateLocalFileSystem(ICollection<string> errors, FileStorageOptions fileStorage)
    {
        if (string.IsNullOrWhiteSpace(fileStorage.RootPath))
        {
            errors.Add("FileStorage:RootPath is required for LocalFileSystem.");
            return;
        }

        try
        {
            Directory.CreateDirectory(Path.GetFullPath(fileStorage.RootPath));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or NotSupportedException)
        {
            errors.Add($"FileStorage:RootPath could not be created: {ex.Message}");
        }
    }

    private static void ValidateObjectStorage(ICollection<string> errors, FileStorageOptions fileStorage)
    {
        if (string.IsNullOrWhiteSpace(fileStorage.BucketName))
        {
            errors.Add("FileStorage:BucketName is required for object storage providers.");
        }

        if (string.IsNullOrWhiteSpace(fileStorage.Region) &&
            string.Equals(fileStorage.Provider, "ObjectStorage", StringComparison.OrdinalIgnoreCase))
        {
            errors.Add("FileStorage:Region is required for ObjectStorage.");
        }

        if (string.IsNullOrWhiteSpace(fileStorage.Endpoint) &&
            string.Equals(fileStorage.Provider, "S3Compatible", StringComparison.OrdinalIgnoreCase))
        {
            errors.Add("FileStorage:Endpoint is required for S3Compatible storage.");
        }
    }
}
