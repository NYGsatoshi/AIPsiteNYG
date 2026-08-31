using System.Text.Json.Serialization;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Announcements;

/// <summary>
/// One exact selected announcement audience. Its IDs are only a requested
/// target; the application re-resolves authorization and parent shape before
/// any Draft save or publication transition.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record AnnouncementDraftTargetRequest(
    Guid? WorkspaceId,
    Guid? GroupId,
    Guid? ChannelId);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record AnnouncementDraftContentRequest(
    AnnouncementDraftTargetRequest Target,
    string Title,
    string Body,
    AnnouncementPriority Priority = AnnouncementPriority.Normal,
    bool IsPinned = false,
    bool RequiresReadConfirmation = false,
    DateTimeOffset? ExpiresAt = null);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CreateAnnouncementDraftRequest(AnnouncementDraftContentRequest Content);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SaveAnnouncementDraftRequest(
    long ExpectedVersion,
    AnnouncementDraftContentRequest Content);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record PublishAnnouncementDraftRequest(long ExpectedVersion);

/// <summary>
/// LocalDateTime must be an unspecified local wall-clock value. The server
/// validates the IANA identifier and resolves it once to ScheduledForUtc.
/// AmbiguousTimeOffsetMinutes is required only for a DST overlap and must be
/// one of the zone's actual offsets for that wall-clock time.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ScheduleAnnouncementDraftRequest(
    long ExpectedVersion,
    DateTime LocalDateTime,
    string TimeZoneId,
    int? AmbiguousTimeOffsetMinutes = null);

public sealed record AnnouncementDraftResponse(
    Guid Id,
    long Version,
    [property: JsonConverter(typeof(JsonStringEnumConverter))] AnnouncementDraftStatus Status,
    Guid? WorkspaceId,
    Guid? GroupId,
    Guid? ChannelId,
    string Title,
    string Body,
    AnnouncementPriority Priority,
    bool IsPinned,
    bool RequiresReadConfirmation,
    DateTimeOffset? ExpiresAt,
    DateTimeOffset? ScheduledForUtc,
    string? ScheduleTimeZoneId,
    DateTime? ScheduleLocalDateTime,
    int? ScheduleUtcOffsetMinutes,
    Guid? PublishedAnnouncementId,
    DateTimeOffset? PublishedAtUtc,
    string? LastPublicationFailureCode,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset? UpdatedAtUtc);

public sealed record AnnouncementDraftListItemResponse(
    Guid Id,
    long Version,
    [property: JsonConverter(typeof(JsonStringEnumConverter))] AnnouncementDraftStatus Status,
    string Title,
    DateTimeOffset? ScheduledForUtc,
    string? ScheduleTimeZoneId,
    Guid? PublishedAnnouncementId,
    DateTimeOffset? PublishedAtUtc,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset? UpdatedAtUtc);

/// <summary>
/// Opaque lease identity passed only from the publisher's durable claim step
/// to its isolated processing scope. It is never returned to browsers.
/// </summary>
public sealed record AnnouncementPublicationClaim(
    Guid DraftId,
    Guid TenantId,
    Guid ClaimToken);
