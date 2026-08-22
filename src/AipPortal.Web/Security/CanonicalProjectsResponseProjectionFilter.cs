using AipPortal.Application.Security.Redaction;
using AipPortal.Web.Controllers;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace AipPortal.Web.Security;

/// <summary>
/// ProjectsController has a large compatibility surface. Enforce the canonical
/// response projection once at the MVC result boundary so individual actions
/// cannot accidentally return a successful DTO without FieldAccessPolicy.
/// </summary>
public sealed class CanonicalProjectsResponseProjectionFilter : IAsyncResultFilter
{
    public async Task OnResultExecutionAsync(
        ResultExecutingContext context,
        ResultExecutionDelegate next)
    {
        if (context.Controller is ProjectsController &&
            context.Result is ObjectResult objectResult &&
            objectResult.Value is not null &&
            IsSuccess(objectResult.StatusCode))
        {
            objectResult.Value = CanonicalRedactionProjection.Apply(
                context.HttpContext,
                objectResult.Value,
                RedactionProfile.UiDetail,
                "ProjectsController",
                RedactionAuthorizationState.Allowed);
        }

        await next();
    }

    private static bool IsSuccess(int? statusCode)
    {
        var status = statusCode ?? StatusCodes.Status200OK;
        return status is >= StatusCodes.Status200OK and < StatusCodes.Status300MultipleChoices;
    }
}
