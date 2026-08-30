using AipPortal.Application.Common;

namespace AipPortal.Application.Search;

public interface ISearchService
{
    Task<Result<SearchResponse>> SearchAsync(SearchRequest request, CancellationToken cancellationToken = default);

    Task<Result<MessageAuthorOptionsResponse>> SearchMessageAuthorsAsync(
        MessageAuthorOptionsRequest request,
        CancellationToken cancellationToken = default);
}
