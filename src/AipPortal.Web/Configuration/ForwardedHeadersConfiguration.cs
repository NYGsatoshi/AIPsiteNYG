using Microsoft.AspNetCore.HttpOverrides;

namespace AipPortal.Web.Configuration;

public static class ForwardedHeadersConfiguration
{
    public const string TrustForwardedHeadersKey = "ReverseProxy:TrustForwardedHeaders";

    public static bool ShouldTrustForwardedHeaders(IConfiguration configuration)
    {
        return configuration.GetValue<bool>(TrustForwardedHeadersKey);
    }

    public static void Configure(ForwardedHeadersOptions options)
    {
        options.ForwardedHeaders =
            ForwardedHeaders.XForwardedFor |
            ForwardedHeaders.XForwardedProto |
            ForwardedHeaders.XForwardedHost;

        // This opt-in path is only safe when the app is network-isolated
        // behind the trusted reverse proxy or tunnel.
        options.KnownIPNetworks.Clear();
        options.KnownProxies.Clear();
        options.RequireHeaderSymmetry = false;
    }
}
