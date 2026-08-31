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
public sealed record AnnouncementDraftContentRequest
{
    [JsonConstructor]
    public AnnouncementDraftContentRequest(
        AnnouncementDraftTargetRequest Target,
        string Title,
        string Body,
        AnnouncementPriority Priority = AnnouncementPriority.Normal,
        bool IsPinned = false,
        bool RequiresReadConfirmation = false,
        DateTimeOffset? ExpiresAt = null,
        AnnouncementActionLink? Cta = null,
        AnnouncementActionLink? Attachment = null)
    {
        var content = AnnouncementContentContract.PrepareForPersistence(Body, Cta, Attachment);
        this.Target = Target;
        this.Title = Title;
        this.Body = content.PersistedBody;
        this.Priority = Priority;
        this.IsPinned = IsPinned;
        this.RequiresReadConfirmation = RequiresReadConfirmation;
        this.ExpiresAt = ExpiresAt;
        this.Cta = content.Cta;
        this.Attachment = content.Attachment;
    }

    public AnnouncementDraftTargetRequest Target { get; init; }
    public string Title { get; init; }
    public string Body { get; init; }
    public AnnouncementPriority Priority { get; init; }
    public bool IsPinned { get; init; }
    public bool RequiresReadConfirmation { get; init; }
    public DateTimeOffset? ExpiresAt { get; init; }
    public AnnouncementActionLink? Cta { get; init; }
    public AnnouncementActionLink? Attachment { get; init; }
}

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

public sealed record AnnouncementDraftResponse
{
    public AnnouncementDraftResponse(
        Guid Id,
        long Version,
        AnnouncementDraftStatus Status,
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
        DateTimeOffset? UpdatedAtUtc)
    {
        var content = AnnouncementContentContract.Decode(Body);
        this.Id = Id;
        this.Version = Version;
        this.Status = Status;
        this.WorkspaceId = WorkspaceId;
        this.GroupId = GroupId;
        this.ChannelId = ChannelId;
        this.Title = Title;
        this.Body = content.Body;
        this.Priority = Priority;
        this.IsPinned = IsPinned;
        this.RequiresReadConfirmation = RequiresReadConfirmation;
        this.ExpiresAt = ExpiresAt;
        this.ScheduledForUtc = ScheduledForUtc;
        this.ScheduleTimeZoneId = ScheduleTimeZoneId;
        this.ScheduleLocalDateTime = ScheduleLocalDateTime;
        this.ScheduleUtcOffsetMinutes = ScheduleUtcOffsetMinutes;
        this.PublishedAnnouncementId = PublishedAnnouncementId;
        this.PublishedAtUtc = PublishedAtUtc;
        this.LastPublicationFailureCode = LastPublicationFailureCode;
        this.CreatedAtUtc = CreatedAtUtc;
        this.UpdatedAtUtc = UpdatedAtUtc;
        Cta = content.Cta;
        Attachment = content.Attachment;
    }

    public Guid Id { get; init; }
    public long Version { get; init; }
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public AnnouncementDraftStatus Status { get; init; }
    public Guid? WorkspaceId { get; init; }
    public Guid? GroupId { get; init; }
    public Guid? ChannelId { get; init; }
    public string Title { get; init; }
    public string Body { get; init; }
    public AnnouncementPriority Priority { get; init; }
    public bool IsPinned { get; init; }
    public bool RequiresReadConfirmation { get; init; }
    public DateTimeOffset? ExpiresAt { get; init; }
    public DateTimeOffset? ScheduledForUtc { get; init; }
    public string? ScheduleTimeZoneId { get; init; }
    public DateTime? ScheduleLocalDateTime { get; init; }
    public int? ScheduleUtcOffsetMinutes { get; init; }
    public Guid? PublishedAnnouncementId { get; init; }
    public DateTimeOffset? PublishedAtUtc { get; init; }
    public string? LastPublicationFailureCode { get; init; }
    public DateTimeOffset CreatedAtUtc { get; init; }
    public DateTimeOffset? UpdatedAtUtc { get; init; }
    public AnnouncementActionLink? Cta { get; init; }
    public AnnouncementActionLink? Attachment { get; init; }
}

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
