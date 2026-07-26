using Xunit.Sdk;

namespace AipPortal.Tests.PostgreSql;

internal static class PostgreSqlTestEnvironment
{
    private const string ConnectionStringEnvironmentVariable = "POSTGRES_TEST_CONNECTION_STRING";

    public static string RequireConnectionString()
    {
        var connectionString = Environment.GetEnvironmentVariable(ConnectionStringEnvironmentVariable);
        if (!string.IsNullOrWhiteSpace(connectionString)) return connectionString;

        const string message = "POSTGRES_TEST_CONNECTION_STRING is required to execute PostgreSQL integration tests.";
        if (string.Equals(Environment.GetEnvironmentVariable("CI"), "true", StringComparison.OrdinalIgnoreCase)
            || string.Equals(Environment.GetEnvironmentVariable("GITHUB_ACTIONS"), "true", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(message);

        throw SkipException.ForSkip($"{message} Set it locally to run this category.");
    }
}
