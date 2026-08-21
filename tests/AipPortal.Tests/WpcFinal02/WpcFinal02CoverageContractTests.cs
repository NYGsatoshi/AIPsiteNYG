using System.Reflection;

namespace AipPortal.Tests.WpcFinal02;

[Trait("Scope", "WPCFINAL02")]
public sealed class WpcFinal02CoverageContractTests
{
    private const int ExpectedRequiredTestCount = 67;
    private const string FinalManifestPath = "scripts/ci/wpc-final02-required-tests.txt";

    private static readonly HashSet<string> Wpc02Scopes = new(StringComparer.Ordinal)
    {
        "WPC02A",
        "WPC02B",
        "WPC02C",
        "WPC02D",
        "WPC02E",
        "WPC02F"
    };

    [Fact]
    public void RequiredAcceptanceManifestExactlyMatchesWpc02ScopedTestSurface()
    {
        var required = ReadManifest(FinalManifestPath);
        Assert.Equal(ExpectedRequiredTestCount, required.Count);
        Assert.Equal(required.Count, required.Distinct(StringComparer.Ordinal).Count());

        var discovered = DiscoverWpc02ScopedTests();
        var missing = required.Except(discovered, StringComparer.Ordinal)
            .OrderBy(item => item, StringComparer.Ordinal)
            .ToArray();
        var unmanifested = discovered.Except(required, StringComparer.Ordinal)
            .OrderBy(item => item, StringComparer.Ordinal)
            .ToArray();

        Assert.True(
            missing.Length == 0,
            $"WPC-Final02 manifest entries do not resolve to executable xUnit tests:{Environment.NewLine}{string.Join(Environment.NewLine, missing)}");
        Assert.True(
            unmanifested.Length == 0,
            $"WPC-02 scoped tests are not represented in the WPC-Final02 manifest:{Environment.NewLine}{string.Join(Environment.NewLine, unmanifested)}");
    }

    [Theory]
    [InlineData("scripts/ci/wpc02b-required-tests.txt")]
    [InlineData("scripts/ci/wpc02c-required-tests.txt")]
    [InlineData("scripts/ci/wpc02d-required-tests.txt")]
    public void DedicatedAcceptanceManifestsRemainIncludedInFinalGate(string dedicatedManifestPath)
    {
        var finalManifest = ReadManifest(FinalManifestPath);
        var dedicatedManifest = ReadManifest(dedicatedManifestPath);

        Assert.NotEmpty(dedicatedManifest);
        var missing = dedicatedManifest
            .Where(requiredMethod =>
                !finalManifest.Any(finalEntry =>
                    finalEntry.EndsWith($".{requiredMethod}", StringComparison.Ordinal)))
            .OrderBy(item => item, StringComparer.Ordinal)
            .ToArray();

        Assert.True(
            missing.Length == 0,
            $"{dedicatedManifestPath} contains methods absent from the WPC-Final02 manifest:{Environment.NewLine}{string.Join(Environment.NewLine, missing)}");
    }

    [Fact]
    public void PostgreSqlAcceptanceEntriesRetainProviderBackedDiscoveryContracts()
    {
        var assembly = typeof(WpcFinal02CoverageContractTests).Assembly;
        var entries = ReadManifest(FinalManifestPath)
            .Where(entry => EntryTypeName(entry).EndsWith("PostgreSqlTests", StringComparison.Ordinal))
            .ToArray();

        Assert.NotEmpty(entries);
        foreach (var entry in entries)
        {
            var (type, method) = ResolveTestMethod(assembly, entry);
            Assert.True(
                HasTrait(type, method, "Category", "PostgreSQLIntegration"),
                $"{entry} must retain Category=PostgreSQLIntegration.");
            Assert.True(
                method.GetCustomAttributes(inherit: true)
                    .Any(attribute => attribute.GetType().Name == "PostgreSqlFactAttribute"),
                $"{entry} must use PostgreSqlFactAttribute so missing local provider configuration is explicit and CI configuration is mandatory.");
        }
    }

    private static HashSet<string> DiscoverWpc02ScopedTests()
    {
        var assembly = typeof(WpcFinal02CoverageContractTests).Assembly;
        var discovered = new HashSet<string>(StringComparer.Ordinal);

        foreach (var type in assembly.GetTypes())
        {
            foreach (var method in type.GetMethods(
                         BindingFlags.Instance |
                         BindingFlags.Static |
                         BindingFlags.Public |
                         BindingFlags.NonPublic |
                         BindingFlags.DeclaredOnly))
            {
                if (!IsXunitTest(method))
                    continue;

                var scopes = GetTraitValues(type, method, "Scope");
                if (scopes.Any(Wpc02Scopes.Contains))
                    discovered.Add($"{type.Name}.{method.Name}");
            }
        }

        return discovered;
    }

    private static (Type Type, MethodInfo Method) ResolveTestMethod(Assembly assembly, string entry)
    {
        var separator = entry.LastIndexOf('.');
        Assert.True(separator > 0 && separator < entry.Length - 1, $"Invalid manifest entry: {entry}");

        var typeName = entry[..separator];
        var methodName = entry[(separator + 1)..];
        var type = assembly.GetTypes().SingleOrDefault(candidate => candidate.Name == typeName);
        Assert.NotNull(type);

        var methods = type!.GetMethods(
                BindingFlags.Instance |
                BindingFlags.Static |
                BindingFlags.Public |
                BindingFlags.NonPublic |
                BindingFlags.DeclaredOnly)
            .Where(candidate => candidate.Name == methodName && IsXunitTest(candidate))
            .ToArray();

        Assert.Single(methods);
        return (type, methods[0]);
    }

    private static bool IsXunitTest(MethodInfo method) =>
        method.GetCustomAttributes(inherit: true).Any(attribute => attribute is FactAttribute);

    private static bool HasTrait(
        Type type,
        MethodInfo method,
        string name,
        string value) =>
        GetTraitValues(type, method, name).Contains(value, StringComparer.Ordinal);

    private static IEnumerable<string> GetTraitValues(
        Type type,
        MethodInfo method,
        string name) =>
        type.GetCustomAttributes<TraitAttribute>(inherit: true)
            .Concat(method.GetCustomAttributes<TraitAttribute>(inherit: true))
            .Where(trait => string.Equals(trait.Name, name, StringComparison.Ordinal))
            .Select(trait => trait.Value);

    private static string EntryTypeName(string entry)
    {
        var separator = entry.LastIndexOf('.');
        return separator > 0 ? entry[..separator] : string.Empty;
    }

    private static IReadOnlyList<string> ReadManifest(string relativePath)
    {
        var path = Path.Combine(
            FindRepositoryRoot(),
            relativePath.Replace('/', Path.DirectorySeparatorChar));
        Assert.True(File.Exists(path), $"Required test manifest does not exist: {relativePath}");

        return File.ReadLines(path)
            .Select(line => line.Trim())
            .Where(line => line.Length > 0 && !line.StartsWith('#'))
            .ToArray();
    }

    private static string FindRepositoryRoot()
    {
        for (DirectoryInfo? current = new(AppContext.BaseDirectory);
             current is not null;
             current = current.Parent)
        {
            if (File.Exists(Path.Combine(current.FullName, "AipPortal.slnx")))
                return current.FullName;
        }

        throw new InvalidOperationException(
            $"Could not locate the repository root from {AppContext.BaseDirectory}.");
    }
}
