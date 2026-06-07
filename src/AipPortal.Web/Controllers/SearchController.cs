using AipPortal.Application.Search;
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
        return result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
    }
}
