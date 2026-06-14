using AipPortal.Application.Channels;
using AipPortal.Application.Messaging;
using AipPortal.Application.Planning;
using AipPortal.Application.Projects;

namespace AipPortal.Tests.Performance;

public sealed class PaginationSafetyTests
{
    [Fact]
    public void MessageListQueryClampsPageSize()
    {
        var query = new MessageListQuery(Limit: 10_000);

        Assert.Equal(100, query.SafeLimit);
    }

    [Fact]
    public void PostListQueryClampsPageSizeAndNormalizesPage()
    {
        var query = new PostListQuery(Page: 0, PageSize: 10_000);

        Assert.Equal(1, query.SafePage);
        Assert.Equal(100, query.SafePageSize);
    }

    [Fact]
    public void ThreadListQueryClampsPageSizeAndNormalizesPage()
    {
        var query = new ThreadListQuery(Page: -10, PageSize: 10_000);

        Assert.Equal(1, query.SafePage);
        Assert.Equal(100, query.SafePageSize);
    }

    [Fact]
    public void MyTasksQueryClampsPageSizeAndNormalizesPage()
    {
        var query = new MyTasksQuery(Status: null, DueBefore: null, ProjectId: null, OnlyOverdue: false, Page: -1, PageSize: 10_000);

        Assert.Equal(1, query.SafePage);
        Assert.Equal(100, query.SafePageSize);
    }

    [Fact]
    public void ConversationListQueryClampsPageSizeAndNormalizesPage()
    {
        var query = new ConversationListQuery(Page: -1, PageSize: 10_000);

        Assert.Equal(1, query.SafePage);
        Assert.Equal(100, query.SafePageSize);
    }

    [Fact]
    public void ProjectListQueryClampsPageSizeAndNormalizesPage()
    {
        var query = new ProjectListQuery(Page: -1, PageSize: 10_000);

        Assert.Equal(1, query.SafePage);
        Assert.Equal(100, query.SafePageSize);
    }
}
