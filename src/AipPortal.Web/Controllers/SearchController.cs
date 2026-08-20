using AipPortal.Application.Search;
using AipPortal.Application.Security.Redaction;
using AipPortal.Web.Models;
using AipPortal.Web.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace AipPortal.Web.Controllers;

[ApiController]
[Authorize]
public sealed class SearchController(ISearchService search) : ControllerBase
{
    [HttpGet("api/search")]
    [EnableRateLimiting("search")]
    public async Task<IActionResult> Search([FromQuery] SearchRequest request, CancellationToken cancellationToken)
    {
        var result = await search.SearchAsync(request, cancellationToken);
        return result.IsSuccess
            ? Ok(CanonicalRedactionProjection.Apply(
                HttpContext,
                result.Value!,
                RedactionProfile.SearchSnippet,
                "Search",
                RedactionAuthorizationState.Allowed))
            : BadRequest(CanonicalErrorEnvelope.FromSensitiveResult(
                HttpContext,
                StatusCodes.Status400BadRequest,
                result.ErrorDetail,
                result.Error,
                "SearchFailed"));
    }
}
