namespace AipPortal.Tests.Security;

[Trait("Scope", "WPC02E")]
public sealed class Wpc02EResponseBoundaryArchitectureTests
{
    [Fact]
    public void ProjectsCompatibilitySurface_HasMandatoryCanonicalResultFilter()
    {
        var root = FindRepositoryRoot();
        var registration = File.ReadAllText(Path.Combine(
            root,
            "src",
            "AipPortal.Web",
            "Extensions",
            "DependencyInjection.cs"));
        var filter = File.ReadAllText(Path.Combine(
            root,
            "src",
            "AipPortal.Web",
            "Security",
            "CanonicalProjectsResponseProjectionFilter.cs"));

        Assert.Contains(
            "options.Filters.Add<CanonicalProjectsResponseProjectionFilter>()",
            registration,
            StringComparison.Ordinal);
        Assert.Contains("context.Controller is ProjectsController", filter, StringComparison.Ordinal);
        Assert.Contains("CanonicalRedactionProjection.Apply", filter, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("AuditController.cs")]
    [InlineData("CapabilityGrantsController.cs")]
    [InlineData("FilesController.cs")]
    [InlineData("NotificationsController.cs")]
    [InlineData("ProjectActivationController.cs")]
    [InlineData("SearchController.cs")]
    [InlineData("TenantExportController.cs")]
    [InlineData("WorkspaceProjectsController.cs")]
    [InlineData("WorkspacesController.cs")]
    public void InScopeControllers_DoNotReturnRawSuccessfulResultValues(string fileName)
    {
        var root = FindRepositoryRoot();
        var source = File.ReadAllText(Path.Combine(
            root,
            "src",
            "AipPortal.Web",
            "Controllers",
            fileName));

        Assert.DoesNotContain("Ok(result.Value)", source, StringComparison.Ordinal);
        Assert.DoesNotContain("Ok(result.Value!)", source, StringComparison.Ordinal);
    }

    private static string FindRepositoryRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory);
             directory is not null;
             directory = directory.Parent)
        {
            if (Directory.Exists(Path.Combine(directory.FullName, "src", "AipPortal.Web")) &&
                Directory.Exists(Path.Combine(directory.FullName, "tests", "AipPortal.Tests")))
            {
                return directory.FullName;
            }
        }

        throw new DirectoryNotFoundException("Repository root could not be located for WPC-02E architecture tests.");
    }
}
