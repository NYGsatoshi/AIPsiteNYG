using System.Diagnostics;
using AipPortal.Application.Security.Redaction;
using AipPortal.Web.Models;
using Microsoft.AspNetCore.Http;

namespace AipPortal.Tests.Security;

public sealed class CanonicalRedactionServiceTests
{
    [Fact]
    public void RedactionProfile_ContainsCanonicalProfilesOnly()
    {
        var names = Enum.GetNames<RedactionProfile>();

        Assert.Equal(
            new[]
            {
                "UiList",
                "UiDetail",
                "SearchSnippet",
                "ExportRow",
                "AuditDisplay",
                "NotificationPayload",
                "FileMetadata",
                "ErrorResponse"
            },
            names);
    }

    [Theory]
    [InlineData(RedactionAuthorizationState.Denied)]
    [InlineData(RedactionAuthorizationState.Unknown)]
    public void NonErrorProfile_UnknownOrDeniedAuthorization_FailsClosed(
        RedactionAuthorizationState authorizationState)
    {
        var service = new CanonicalRedactionService();
        var source = new { secret = "must-not-pass-through" };
        var context = CreateContext(authorizationState);

        var result = service.Redact(context, source, RedactionProfile.UiDetail);

        Assert.True(result.RedactionApplied);
        var redacted = Assert.IsType<RedactedPayload>(result.Value);
        Assert.Equal(RedactionProfile.UiDetail, redacted.Profile);
        Assert.Equal("authorization", redacted.Reason);
        Assert.NotSame(source, result.Value);
    }

    [Fact]
    public void ErrorResponse_PublicSafeContent_PassesThroughWithoutClaimingRedaction()
    {
        var service = new CanonicalRedactionService();
        var source = new ErrorRedactionSource(
            "ValidationFailed",
            "The request body or parameters are invalid.",
            "body",
            Array.Empty<object>(),
            RedactionSensitivity.PublicSafe);

        var result = service.Redact(
            CreateContext(RedactionAuthorizationState.Unknown),
            source,
            RedactionProfile.ErrorResponse);

        Assert.False(result.RedactionApplied);
        Assert.Equal(source, Assert.IsType<ErrorRedactionSource>(result.Value));
    }

    [Theory]
    [InlineData(RedactionAuthorizationState.Denied)]
    [InlineData(RedactionAuthorizationState.Unknown)]
    public void ErrorResponse_SensitiveContent_FailsClosedAndReportsActualChange(
        RedactionAuthorizationState authorizationState)
    {
        var service = new CanonicalRedactionService();
        var source = new ErrorRedactionSource(
            "LookupFailed",
            "Sensitive internal failure for student@example.invalid",
            "body.studentEmail",
            new object[] { "database detail" },
            RedactionSensitivity.Sensitive);

        var result = service.Redact(
            CreateContext(authorizationState),
            source,
            RedactionProfile.ErrorResponse);

        Assert.True(result.RedactionApplied);
        var redacted = Assert.IsType<ErrorRedactionSource>(result.Value);
        Assert.Equal("LookupFailed", redacted.Code);
        Assert.Equal("The request could not be completed.", redacted.Message);
        Assert.Null(redacted.Target);
        Assert.Empty(redacted.Details);
        Assert.Equal(RedactionSensitivity.PublicSafe, redacted.Sensitivity);
    }

    [Fact]
    public void ErrorResponse_SensitiveContent_WithAffirmativeAuthorization_PassesThrough()
    {
        var service = new CanonicalRedactionService();
        var source = new ErrorRedactionSource(
            "LookupFailed",
            "Authorized diagnostic",
            "body.value",
            new object[] { "detail" },
            RedactionSensitivity.Sensitive);

        var result = service.Redact(
            CreateContext(RedactionAuthorizationState.Allowed),
            source,
            RedactionProfile.ErrorResponse);

        Assert.False(result.RedactionApplied);
        Assert.Equal(source, Assert.IsType<ErrorRedactionSource>(result.Value));
    }

    [Fact]
    public void WpcEnvelope_PublicSafeError_PreservesRequestAndTraceIds_AndReportsNoRedaction()
    {
        var httpContext = new DefaultHttpContext
        {
            TraceIdentifier = "request-123"
        };
        using var activity = new Activity("redaction-test");
        activity.SetIdFormat(ActivityIdFormat.W3C);
        activity.Start();

        var envelope = ApiEnvelope.Error(
            httpContext,
            StatusCodes.Status400BadRequest,
            "ValidationFailed",
            "The request body or parameters are invalid.",
            "body");

        Assert.Equal("request-123", envelope.RequestId);
        Assert.Equal(activity.Id, envelope.TraceId);
        Assert.Equal(StatusCodes.Status400BadRequest, envelope.Status);
        Assert.Equal("ValidationFailed", envelope.Error.Code);
        Assert.Equal("The request body or parameters are invalid.", envelope.Error.Message);
        Assert.Equal("body", envelope.Error.Target);
        Assert.False(envelope.Error.RedactionApplied);
    }

    [Fact]
    public void WpcEnvelope_SensitiveError_UsesCanonicalErrorResponseRedaction()
    {
        var httpContext = new DefaultHttpContext
        {
            TraceIdentifier = "request-sensitive"
        };

        var envelope = ApiEnvelope.Error(
            httpContext,
            StatusCodes.Status500InternalServerError,
            "LookupFailed",
            "Sensitive internal failure",
            "body.secret",
            redactionApplied: true);

        Assert.Equal("request-sensitive", envelope.RequestId);
        Assert.False(string.IsNullOrWhiteSpace(envelope.TraceId));
        Assert.Equal("LookupFailed", envelope.Error.Code);
        Assert.Equal("The request could not be completed.", envelope.Error.Message);
        Assert.Null(envelope.Error.Target);
        Assert.Empty(envelope.Error.Details);
        Assert.True(envelope.Error.RedactionApplied);
    }

    private static AuthorizationContext CreateContext(RedactionAuthorizationState authorizationState) =>
        new(
            ActorId: null,
            TenantId: null,
            ModuleKey: "Tests",
            Purpose: "NormalOperation",
            RequestId: "request-test",
            AuthorizationState: authorizationState);
}
