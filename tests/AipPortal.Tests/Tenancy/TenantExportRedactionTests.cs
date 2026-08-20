using AipPortal.Application.Common.Tenancy;
using AipPortal.Application.Security.Redaction;
using AipPortal.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Tests.Tenancy;

[Trait("Scope", "WPC02E")]
public sealed class TenantExportRedactionTests
{
    [Fact]
    public async Task MetadataZip_RoutesSerializedRowsThroughExportRowRedaction()
    {
        var currentTenant = new CurrentTenantService();
        currentTenant.SetPlatformScope();
        await using var dbContext = CreateDbContext(currentTenant);
        var redactor = new RecordingRedactionService();
        var repository = new TenantExportRepository(dbContext, redactor);
        var context = CreateAuthorizationContext();

        var archive = await repository.CreateMetadataZipAsync(
            context.TenantId!.Value,
            context,
            CancellationToken.None);

        Assert.NotEmpty(archive);
        var call = Assert.Single(redactor.Calls);
        Assert.Equal(context, call.Context);
        Assert.Equal(RedactionProfile.ExportRow, call.Profile);
    }

    [Fact]
    public async Task MetadataZip_FailsClosed_WhenExportRowCannotBeSerialized()
    {
        var currentTenant = new CurrentTenantService();
        currentTenant.SetPlatformScope();
        await using var dbContext = CreateDbContext(currentTenant);
        var repository = new TenantExportRepository(dbContext, new ClosedRedactionService());
        var context = CreateAuthorizationContext();

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            repository.CreateMetadataZipAsync(
                context.TenantId!.Value,
                context,
                CancellationToken.None));

        Assert.Contains("serializable export row", exception.Message);
    }

    private static AppDbContext CreateDbContext(CurrentTenantService currentTenant) =>
        new(
            new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
                .Options,
            currentTenant);

    private static AuthorizationContext CreateAuthorizationContext() =>
        new(
            ActorId: Guid.NewGuid(),
            TenantId: Guid.NewGuid(),
            ModuleKey: "TenantExport",
            Purpose: "ExportBuild",
            RequestId: "wpc02e-export-build",
            AuthorizationState: RedactionAuthorizationState.Allowed);

    private sealed class RecordingRedactionService : IRedactionService
    {
        public List<(AuthorizationContext Context, RedactionProfile Profile)> Calls { get; } = [];

        public RedactionResult Redact(
            AuthorizationContext context,
            object source,
            RedactionProfile profile)
        {
            Calls.Add((context, profile));
            return new RedactionResult(source, RedactionApplied: false);
        }
    }

    private sealed class ClosedRedactionService : IRedactionService
    {
        public RedactionResult Redact(
            AuthorizationContext context,
            object source,
            RedactionProfile profile) =>
            new(new RedactedPayload(profile, "authorization"), RedactionApplied: true);
    }
}
