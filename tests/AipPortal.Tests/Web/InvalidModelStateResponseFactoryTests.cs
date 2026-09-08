using AipPortal.Web.Extensions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace AipPortal.Tests.Web;

public sealed class InvalidModelStateResponseFactoryTests
{
    [Fact]
    public void GenericValidationFailureReturnsBadRequestWhenMvcDefaultFactoryIsUnavailable()
    {
        var services = new ServiceCollection();
        services.AddWebServices(new ConfigurationBuilder().Build());
        using var provider = services.BuildServiceProvider();
        var options = provider.GetRequiredService<IOptions<ApiBehaviorOptions>>().Value;
        var httpContext = new DefaultHttpContext { RequestServices = provider };
        httpContext.Request.Path = "/api/files/00000000-0000-0000-0000-000000000001/move";
        var actionContext = new ActionContext(
            httpContext,
            new RouteData(),
            new ActionDescriptor(),
            new ModelStateDictionary());
        actionContext.ModelState.AddModelError("expectedDestinationVersion", "The field must be non-negative.");

        var result = options.InvalidModelStateResponseFactory(actionContext);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.IsType<ValidationProblemDetails>(badRequest.Value);
    }
}
