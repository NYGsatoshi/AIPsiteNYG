using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Realtime;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Announcements;

/// <summary>
/// Minimal durable publication workflow for #378. It owns a single saved
/// target, a versioned draft, accepted UTC scheduling, idempotent transitions,
/// and the worker's real publication mutation. It intentionally does not own
/// preview rendering, campaigns, links, attachments, analytics, or recipient
/// delivery ledgers.
/// </summary>
public sealed class AnnouncementDraftService(
    IAnnouncementDraftRepository drafts,
    IAnnouncementRepository announcements,
    IAnnouncementAudienceService audiences,
    ICreateIdempotencyCoordinator idempotency,
    ICurrentUser currentUser,
    ICurrentTenant currentTenant,
    IClock clock,
    IAuditLogger audit,
    IBusinessInvalidationPublisher invalidations,
    IUnitOfWork unitOfWork) : IAnnouncementDraftService, IAnnouncementPublicationProcessor
{
    private const string CreateOperation = "AnnouncementDraft.Create.v1";
    private const string PublishOperation = "AnnouncementDraft.Publish.v1";
    private const string ScheduleOperation = "AnnouncementDraft.Schedule.v1";
    private const string ResourceType = "AnnouncementDraft";
    private const string AudienceNoLongerAuthorized = "AudienceNoLongerAuthorized";
    private const string PublicationWorkerRetry = "PublicationWorkerRetry";

    public async Task<Result<AnnouncementDraftResponse>> CreateAsync(
        CreateAnnouncementDraftRequest request,
        string idempotencyKey,
        CancellationToken cancellationToken = default)
    {
        if (!TryCurrentActor(out var actorUserId, out var actorError))
        {
            return Failure<AnnouncementDraftResponse>("ANNOUNCEMENT_DRAFT_AUTHENTICATION_REQUIRED", actorError!);
        }

        if (!IsValidIdempotencyKey(idempotencyKey))
        {
            return IdempotencyFailure<AnnouncementDraftResponse>(idempotencyKey);
        }

        var contentValidation = await ValidateContentAsync(actorUserId, request.Content, clock.UtcNow, cancellationToken);
        if (!contentValidation.IsSuccess)
        {
            return Result<AnnouncementDraftResponse>.Failure(contentValidation.ErrorDetail!);
        }

        var draft = new AnnouncementDraft
        {
            TenantId = currentTenant.TenantId,
            AuthorUserId = actorUserId,
            VersionNo = 1
        };

        try
        {
            var result = await idempotency.ExecuteAsync(
                new CreateIdempotencyContext(
                    currentTenant.TenantId,
                    actorUserId,
                    CreateOperation,
                    idempotencyKey.Trim(),
                    Fingerprint(request),
                    ResourceType,
                    draft.Id),
                async token =>
                {
                    ApplyContent(draft, request.Content);
                    await drafts.AddAsync(draft, token);
                    await audit.LogUserActionAsync(
                        actorUserId,
                        "AnnouncementDraftCreated",
                        "AnnouncementDraft",
                        draft.Id,
                        "Announcement draft saved.",
                        new Dictionary<string, object?> { ["version"] = draft.VersionNo },
                        token);
                    return draft;
                },
                async (draftId, token) => await drafts.GetAsync(draftId, token),
                cancellationToken);

            return result.Disposition switch
            {
                IdempotentCreateDisposition.Created or IdempotentCreateDisposition.Replayed when result.Value is not null &&
                    await CanAccessDraftAsync(actorUserId, result.Value, cancellationToken) =>
                    Result<AnnouncementDraftResponse>.Success(ToResponse(result.Value)),
                IdempotentCreateDisposition.RequestMismatch => IdempotencyConflict<AnnouncementDraftResponse>(),
                _ => ReplayUnavailable<AnnouncementDraftResponse>()
            };
        }
        catch (Exception exception) when (IsConcurrencyConflict(exception))
        {
            return Stale<AnnouncementDraftResponse>();
        }
        catch (InvalidOperationException)
        {
            return Failure<AnnouncementDraftResponse>(
                "ANNOUNCEMENT_DRAFT_PERSISTENCE_UNAVAILABLE",
                "The announcement draft could not be saved.");
        }
    }

    public async Task<Result<IReadOnlyList<AnnouncementDraftListItemResponse>>> ListMineAsync(
        CancellationToken cancellationToken = default)
    {
        if (!TryCurrentActor(out var actorUserId, out var actorError))
        {
            return Failure<IReadOnlyList<AnnouncementDraftListItemResponse>>(
                "ANNOUNCEMENT_DRAFT_AUTHENTICATION_REQUIRED",
                actorError!);
        }

        var candidates = await drafts.ListForAuthorAsync(actorUserId, 50, cancellationToken);
        var items = new List<AnnouncementDraftListItemResponse>(candidates.Count);
        foreach (var draft in candidates)
        {
            if (await CanAccessDraftAsync(actorUserId, draft, cancellationToken))
            {
                items.Add(ToListItem(draft));
            }
        }

        return Result<IReadOnlyList<AnnouncementDraftListItemResponse>>.Success(items);
    }

    public async Task<Result<AnnouncementDraftResponse>> GetAsync(
        Guid draftId,
        CancellationToken cancellationToken = default)
    {
        if (!TryCurrentActor(out var actorUserId, out _))
        {
            return NotFound<AnnouncementDraftResponse>();
        }

        var draft = await drafts.GetAsync(draftId, cancellationToken);
        return draft is not null && await CanAccessDraftAsync(actorUserId, draft, cancellationToken)
            ? Result<AnnouncementDraftResponse>.Success(ToResponse(draft))
            : NotFound<AnnouncementDraftResponse>();
    }

    public async Task<Result<AnnouncementDraftResponse>> SaveAsync(
        Guid draftId,
        SaveAnnouncementDraftRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!TryCurrentActor(out var actorUserId, out _))
        {
            return NotFound<AnnouncementDraftResponse>();
        }

        var draft = await drafts.GetAsync(draftId, cancellationToken);
        if (draft is null || !await CanAccessDraftAsync(actorUserId, draft, cancellationToken))
        {
            return NotFound<AnnouncementDraftResponse>();
        }
        if (draft.Status != AnnouncementDraftStatus.Draft)
        {
            return Failure<AnnouncementDraftResponse>(
                "ANNOUNCEMENT_DRAFT_NOT_EDITABLE",
                "Only a draft can be edited.");
        }
        if (request.ExpectedVersion != draft.VersionNo)
        {
            return Stale<AnnouncementDraftResponse>();
        }

        var validation = await ValidateContentAsync(actorUserId, request.Content, clock.UtcNow, cancellationToken);
        if (!validation.IsSuccess)
        {
            return Result<AnnouncementDraftResponse>.Failure(validation.ErrorDetail!);
        }

        ApplyContent(draft, request.Content);
        draft.VersionNo = checked(draft.VersionNo + 1);
        await audit.LogUserActionAsync(
            actorUserId,
            "AnnouncementDraftSaved",
            "AnnouncementDraft",
            draft.Id,
            "Announcement draft updated.",
            new Dictionary<string, object?> { ["version"] = draft.VersionNo },
            cancellationToken);

        try
        {
            await unitOfWork.SaveChangesAsync(cancellationToken);
            return Result<AnnouncementDraftResponse>.Success(ToResponse(draft));
        }
        catch (Exception exception) when (IsConcurrencyConflict(exception))
        {
            return Stale<AnnouncementDraftResponse>();
        }
    }

    public Task<Result<AnnouncementDraftResponse>> PublishNowAsync(
        Guid draftId,
        PublishAnnouncementDraftRequest request,
        string idempotencyKey,
        CancellationToken cancellationToken = default) =>
        TransitionAsync(
            draftId,
            request.ExpectedVersion,
            idempotencyKey,
            PublishOperation,
            Fingerprint(request),
            async (draft, actorUserId, token) =>
            {
                // “Publish now” is still a durable due-time request. The
                // command never creates an Announcement itself: it queues an
                // immediate UTC schedule, then the worker reauthorizes the
                // retained audience before the only Scheduled -> Published
                // mutation. This keeps Draft -> Scheduled -> Published true
                // for both immediate and user-scheduled delivery.
                var dueAtUtc = clock.UtcNow;
                if (draft.ExpiresAt.HasValue && draft.ExpiresAt.Value <= dueAtUtc)
                {
                    throw new AnnouncementTransitionValidationException(
                        "Announcement expiration must be after publication.");
                }

                draft.Status = AnnouncementDraftStatus.Scheduled;
                draft.ScheduledForUtc = dueAtUtc;
                draft.ScheduleTimeZoneId = "UTC";
                draft.ScheduleLocalDateTime = DateTime.SpecifyKind(
                    dueAtUtc.UtcDateTime,
                    DateTimeKind.Unspecified);
                draft.ScheduleUtcOffsetMinutes = null;
                draft.NextPublicationAttemptAtUtc = dueAtUtc;
                draft.LastPublicationFailureCode = null;
                ClearClaim(draft);
                draft.VersionNo = checked(draft.VersionNo + 1);
                await audit.LogUserActionAsync(
                    actorUserId,
                    "AnnouncementDraftQueuedForImmediatePublication",
                    "AnnouncementDraft",
                    draft.Id,
                    "Announcement publication queued for immediate delivery.",
                    new Dictionary<string, object?>
                    {
                        ["version"] = draft.VersionNo,
                        ["scheduledForUtc"] = dueAtUtc
                    },
                    token);
            },
            cancellationToken);

    public async Task<Result<AnnouncementDraftResponse>> ScheduleAsync(
        Guid draftId,
        ScheduleAnnouncementDraftRequest request,
        string idempotencyKey,
        CancellationToken cancellationToken = default)
    {
        var resolution = ResolveSchedule(request);
        if (!resolution.IsSuccess)
        {
            return Result<AnnouncementDraftResponse>.Failure(resolution.ErrorDetail!);
        }

        return await TransitionAsync(
            draftId,
            request.ExpectedVersion,
            idempotencyKey,
            ScheduleOperation,
            Fingerprint(request),
            async (draft, actorUserId, token) =>
            {
                var accepted = resolution.Value!;
                if (accepted.DueAtUtc <= clock.UtcNow)
                {
                    throw new AnnouncementTransitionValidationException(
                        "Scheduled publication must be in the future.");
                }
                if (draft.ExpiresAt.HasValue && draft.ExpiresAt.Value <= accepted.DueAtUtc)
                {
                    throw new AnnouncementTransitionValidationException(
                        "Announcement expiration must be after scheduled publication.");
                }

                draft.Status = AnnouncementDraftStatus.Scheduled;
                draft.ScheduledForUtc = accepted.DueAtUtc;
                draft.ScheduleTimeZoneId = accepted.TimeZoneId;
                draft.ScheduleLocalDateTime = accepted.LocalDateTime;
                draft.ScheduleUtcOffsetMinutes = accepted.AmbiguousTimeOffsetMinutes;
                draft.NextPublicationAttemptAtUtc = accepted.DueAtUtc;
                draft.LastPublicationFailureCode = null;
                ClearClaim(draft);
                draft.VersionNo = checked(draft.VersionNo + 1);
                await audit.LogUserActionAsync(
                    actorUserId,
                    "AnnouncementDraftScheduled",
                    "AnnouncementDraft",
                    draft.Id,
                    "Announcement publication scheduled.",
                    new Dictionary<string, object?>
                    {
                        ["version"] = draft.VersionNo,
                        ["scheduledForUtc"] = accepted.DueAtUtc,
                        ["timeZoneId"] = accepted.TimeZoneId
                    },
                    token);
            },
            cancellationToken);
    }

    public Task<IReadOnlyList<Guid>> ListActiveTenantIdsAsync(
        int page,
        int pageSize,
        CancellationToken cancellationToken = default) =>
        drafts.ListActiveTenantIdsAsync(page, pageSize, cancellationToken);

    public Task<IReadOnlyList<AnnouncementPublicationClaim>> ClaimDueAsync(
        string claimOwner,
        DateTimeOffset now,
        int batchSize,
        TimeSpan claimTimeout,
        CancellationToken cancellationToken = default) =>
        drafts.ClaimDueAsync(claimOwner, now, batchSize, claimTimeout, cancellationToken);

    public async Task ProcessAsync(
        AnnouncementPublicationClaim claim,
        DateTimeOffset now,
        TimeSpan retryDelay,
        CancellationToken cancellationToken = default)
    {
        var draft = await drafts.GetClaimedAsync(claim.DraftId, claim.ClaimToken, cancellationToken);
        if (draft is null)
        {
            return;
        }

        var validation = await ValidateContentAsync(draft.AuthorUserId, ToContent(draft), now, cancellationToken);
        if (!validation.IsSuccess)
        {
            await DeferClaimAsync(draft, "DraftValidationFailed", now, retryDelay, cancellationToken);
            return;
        }

        var authorized = await audiences.IsAuthorizedForActorAsync(
            draft.AuthorUserId,
            draft.WorkspaceId,
            draft.GroupId,
            draft.ChannelId,
            cancellationToken);
        if (!authorized.IsSuccess)
        {
            await DeferClaimAsync(draft, PublicationWorkerRetry, now, retryDelay, cancellationToken);
            return;
        }
        if (authorized.Value != true)
        {
            await DeferClaimAsync(draft, AudienceNoLongerAuthorized, now, retryDelay, cancellationToken);
            return;
        }

        if (draft.ExpiresAt.HasValue && draft.ExpiresAt.Value <= now)
        {
            await DeferClaimAsync(draft, "AnnouncementExpiredBeforePublication", now, retryDelay, cancellationToken);
            return;
        }

        await PublishDraftAsync(draft, now, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
    }

    public async Task RecordFailureAsync(
        AnnouncementPublicationClaim claim,
        DateTimeOffset now,
        TimeSpan retryDelay,
        CancellationToken cancellationToken = default)
    {
        var draft = await drafts.GetClaimedAsync(claim.DraftId, claim.ClaimToken, cancellationToken);
        if (draft is not null)
        {
            await DeferClaimAsync(draft, PublicationWorkerRetry, now, retryDelay, cancellationToken);
        }
    }

    private async Task<Result<AnnouncementDraftResponse>> TransitionAsync(
        Guid draftId,
        long expectedVersion,
        string idempotencyKey,
        string operation,
        string fingerprint,
        Func<AnnouncementDraft, Guid, CancellationToken, Task> stageTransition,
        CancellationToken cancellationToken)
    {
        if (!TryCurrentActor(out var actorUserId, out _))
        {
            return NotFound<AnnouncementDraftResponse>();
        }
        if (!IsValidIdempotencyKey(idempotencyKey))
        {
            return IdempotencyFailure<AnnouncementDraftResponse>(idempotencyKey);
        }

        var draft = await drafts.GetAsync(draftId, cancellationToken);
        if (draft is null || !await CanAccessDraftAsync(actorUserId, draft, cancellationToken))
        {
            return NotFound<AnnouncementDraftResponse>();
        }
        try
        {
            var result = await idempotency.ExecuteAsync(
                new CreateIdempotencyContext(
                    currentTenant.TenantId,
                    actorUserId,
                    operation,
                    idempotencyKey.Trim(),
                    fingerprint,
                    ResourceType,
                    draft.Id),
                async token =>
                {
                    // The previously fetched target was only a read shortcut.
                    // Every accepted transition rechecks current scope inside
                    // the transaction that stores it.
                    if (!await CanAccessDraftAsync(actorUserId, draft, token))
                    {
                        throw new AnnouncementTransitionValidationException("The selected audience is no longer authorized.");
                    }
                    // This validation deliberately lives inside the
                    // idempotency coordinator. A client that lost the first
                    // response must be able to replay the exact accepted
                    // transition even though the persisted draft is now
                    // Scheduled or Published.
                    if (draft.Status != AnnouncementDraftStatus.Draft)
                    {
                        throw new AnnouncementTransitionNotReadyException();
                    }
                    if (draft.VersionNo != expectedVersion)
                    {
                        throw new AnnouncementTransitionConflictException();
                    }
                    var validation = await ValidateContentAsync(actorUserId, ToContent(draft), clock.UtcNow, token);
                    if (!validation.IsSuccess)
                    {
                        throw new AnnouncementTransitionValidationException(
                            validation.ErrorDetail?.Message ?? "Announcement draft is invalid.");
                    }
                    await stageTransition(draft, actorUserId, token);
                    return draft;
                },
                async (existingDraftId, token) => await drafts.GetAsync(existingDraftId, token),
                cancellationToken);

            return result.Disposition switch
            {
                IdempotentCreateDisposition.Created or IdempotentCreateDisposition.Replayed when result.Value is not null &&
                    await CanAccessDraftAsync(actorUserId, result.Value, cancellationToken) =>
                    Result<AnnouncementDraftResponse>.Success(ToResponse(result.Value)),
                IdempotentCreateDisposition.RequestMismatch => IdempotencyConflict<AnnouncementDraftResponse>(),
                _ => ReplayUnavailable<AnnouncementDraftResponse>()
            };
        }
        catch (AnnouncementTransitionConflictException)
        {
            return Stale<AnnouncementDraftResponse>();
        }
        catch (AnnouncementTransitionNotReadyException)
        {
            return Failure<AnnouncementDraftResponse>(
                "ANNOUNCEMENT_DRAFT_NOT_READY",
                "Only a draft can be published or scheduled.");
        }
        catch (AnnouncementTransitionValidationException exception)
        {
            return Failure<AnnouncementDraftResponse>("ANNOUNCEMENT_DRAFT_TRANSITION_INVALID", exception.Message);
        }
        catch (Exception exception) when (IsConcurrencyConflict(exception))
        {
            return Stale<AnnouncementDraftResponse>();
        }
        catch (InvalidOperationException)
        {
            return Failure<AnnouncementDraftResponse>(
                "ANNOUNCEMENT_DRAFT_PERSISTENCE_UNAVAILABLE",
                "The announcement publication could not be recorded.");
        }
    }

    private async Task PublishDraftAsync(
        AnnouncementDraft draft,
        DateTimeOffset publishedAtUtc,
        CancellationToken cancellationToken)
    {
        var announcement = new Announcement
        {
            TenantId = draft.TenantId,
            WorkspaceId = draft.WorkspaceId,
            GroupId = draft.GroupId,
            ChannelId = draft.ChannelId,
            AuthorUserId = draft.AuthorUserId,
            Title = draft.Title,
            Body = draft.Body,
            Priority = draft.Priority,
            IsPinned = draft.IsPinned,
            RequiresReadConfirmation = draft.RequiresReadConfirmation,
            PublishedAt = publishedAtUtc,
            ExpiresAt = draft.ExpiresAt
        };

        await announcements.AddAsync(announcement, cancellationToken);
        var recipients = await announcements.ListTargetUsersAsync(announcement, cancellationToken);

        draft.Status = AnnouncementDraftStatus.Published;
        draft.PublishedAnnouncementId = announcement.Id;
        draft.PublishedAtUtc = publishedAtUtc;
        draft.NextPublicationAttemptAtUtc = null;
        draft.LastPublicationFailureCode = null;
        ClearClaim(draft);
        draft.VersionNo = checked(draft.VersionNo + 1);

        await audit.LogUserActionAsync(
            draft.AuthorUserId,
            "AnnouncementPublished",
            "Announcement",
            announcement.Id,
            "Announcement published from durable draft.",
            new Dictionary<string, object?> { ["draftId"] = draft.Id, ["draftVersion"] = draft.VersionNo },
            cancellationToken);
        await invalidations.AnnouncementChangedAsync(
            announcement,
            draft.AuthorUserId,
            "created",
            recipients.Select(recipient => recipient.UserId),
            cancellationToken);
    }

    private async Task DeferClaimAsync(
        AnnouncementDraft draft,
        string failureCode,
        DateTimeOffset now,
        TimeSpan retryDelay,
        CancellationToken cancellationToken)
    {
        draft.LastPublicationFailureCode = failureCode;
        draft.NextPublicationAttemptAtUtc = now + (retryDelay <= TimeSpan.Zero ? TimeSpan.FromMinutes(5) : retryDelay);
        ClearClaim(draft);
        draft.VersionNo = checked(draft.VersionNo + 1);
        await audit.LogUserActionAsync(
            draft.AuthorUserId,
            "AnnouncementPublicationDeferred",
            "AnnouncementDraft",
            draft.Id,
            "Scheduled announcement publication was deferred.",
            new Dictionary<string, object?> { ["failureCode"] = failureCode },
            cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
    }

    private async Task<bool> CanAccessDraftAsync(
        Guid actorUserId,
        AnnouncementDraft draft,
        CancellationToken cancellationToken)
    {
        if (actorUserId != draft.AuthorUserId || draft.TenantId != currentTenant.TenantId)
        {
            return false;
        }

        var authorization = await audiences.IsAuthorizedForActorAsync(
            actorUserId,
            draft.WorkspaceId,
            draft.GroupId,
            draft.ChannelId,
            cancellationToken);
        return authorization.IsSuccess && authorization.Value == true;
    }

    private async Task<Result> ValidateContentAsync(
        Guid actorUserId,
        AnnouncementDraftContentRequest content,
        DateTimeOffset publicationTime,
        CancellationToken cancellationToken)
    {
        if (content is null || content.Target is null)
        {
            return Failure("ANNOUNCEMENT_DRAFT_VALIDATION_FAILED", "An announcement audience is required.");
        }
        if (string.IsNullOrWhiteSpace(content.Title) || content.Title.Trim().Length > 200)
        {
            return Failure("ANNOUNCEMENT_DRAFT_VALIDATION_FAILED", "Announcement title is required and must be 200 characters or fewer.");
        }
        if (string.IsNullOrWhiteSpace(content.Body) || content.Body.Trim().Length > 20000)
        {
            return Failure("ANNOUNCEMENT_DRAFT_VALIDATION_FAILED", "Announcement body is required and must be 20,000 characters or fewer.");
        }
        if (!Enum.IsDefined(content.Priority) || !HasValidTargetShape(content.Target))
        {
            return Failure("ANNOUNCEMENT_DRAFT_VALIDATION_FAILED", "Announcement content is invalid.");
        }
        if (content.ExpiresAt.HasValue && content.ExpiresAt.Value <= publicationTime)
        {
            return Failure("ANNOUNCEMENT_DRAFT_VALIDATION_FAILED", "Announcement expiration must be in the future.");
        }

        var authorized = await audiences.IsAuthorizedForActorAsync(
            actorUserId,
            content.Target.WorkspaceId,
            content.Target.GroupId,
            content.Target.ChannelId,
            cancellationToken);
        return authorized.IsSuccess && authorized.Value == true
            ? Result.Success()
            : Failure("ANNOUNCEMENT_DRAFT_AUDIENCE_DENIED", "The selected announcement audience is not authorized.");
    }

    private static Result<ScheduleResolution> ResolveSchedule(ScheduleAnnouncementDraftRequest request)
    {
        if (request.LocalDateTime.Kind != DateTimeKind.Unspecified ||
            string.IsNullOrWhiteSpace(request.TimeZoneId) ||
            request.TimeZoneId.Trim().Length > 80 ||
            (!string.Equals(request.TimeZoneId.Trim(), "UTC", StringComparison.Ordinal) && !request.TimeZoneId.Contains('/', StringComparison.Ordinal)))
        {
            return Failure<ScheduleResolution>(
                "ANNOUNCEMENT_DRAFT_SCHEDULE_INVALID",
                "A local date and an IANA time zone are required.");
        }

        TimeZoneInfo zone;
        try
        {
            zone = TimeZoneInfo.FindSystemTimeZoneById(request.TimeZoneId.Trim());
        }
        catch (TimeZoneNotFoundException)
        {
            return Failure<ScheduleResolution>("ANNOUNCEMENT_DRAFT_SCHEDULE_INVALID", "The selected time zone is not supported.");
        }
        catch (InvalidTimeZoneException)
        {
            return Failure<ScheduleResolution>("ANNOUNCEMENT_DRAFT_SCHEDULE_INVALID", "The selected time zone is not supported.");
        }

        if (zone.IsInvalidTime(request.LocalDateTime))
        {
            return Failure<ScheduleResolution>("ANNOUNCEMENT_DRAFT_SCHEDULE_INVALID", "The selected local time does not exist in that time zone.");
        }

        DateTimeOffset dueAtUtc;
        if (zone.IsAmbiguousTime(request.LocalDateTime))
        {
            if (!request.AmbiguousTimeOffsetMinutes.HasValue)
            {
                return Failure<ScheduleResolution>("ANNOUNCEMENT_DRAFT_SCHEDULE_AMBIGUOUS", "The selected local time is ambiguous. Choose a different time or offset.");
            }

            var suppliedOffset = TimeSpan.FromMinutes(request.AmbiguousTimeOffsetMinutes.Value);
            if (!zone.GetAmbiguousTimeOffsets(request.LocalDateTime).Contains(suppliedOffset))
            {
                return Failure<ScheduleResolution>("ANNOUNCEMENT_DRAFT_SCHEDULE_INVALID", "The selected time-zone offset is invalid.");
            }
            dueAtUtc = new DateTimeOffset(request.LocalDateTime, suppliedOffset).ToUniversalTime();
        }
        else
        {
            if (request.AmbiguousTimeOffsetMinutes.HasValue)
            {
                return Failure<ScheduleResolution>("ANNOUNCEMENT_DRAFT_SCHEDULE_INVALID", "A time-zone offset may be supplied only for an ambiguous local time.");
            }
            dueAtUtc = new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(request.LocalDateTime, zone), TimeSpan.Zero);
        }

        return Result<ScheduleResolution>.Success(new ScheduleResolution(
            dueAtUtc,
            request.TimeZoneId.Trim(),
            request.LocalDateTime,
            request.AmbiguousTimeOffsetMinutes));
    }

    private static void ApplyContent(AnnouncementDraft draft, AnnouncementDraftContentRequest content)
    {
        draft.WorkspaceId = content.Target.WorkspaceId;
        draft.GroupId = content.Target.GroupId;
        draft.ChannelId = content.Target.ChannelId;
        draft.Title = content.Title.Trim();
        draft.Body = content.Body.Trim();
        draft.Priority = content.Priority;
        draft.IsPinned = content.IsPinned;
        draft.RequiresReadConfirmation = content.RequiresReadConfirmation;
        draft.ExpiresAt = content.ExpiresAt;
    }

    private static AnnouncementDraftContentRequest ToContent(AnnouncementDraft draft) => new(
        new AnnouncementDraftTargetRequest(draft.WorkspaceId, draft.GroupId, draft.ChannelId),
        draft.Title,
        draft.Body,
        draft.Priority,
        draft.IsPinned,
        draft.RequiresReadConfirmation,
        draft.ExpiresAt);

    private static bool HasValidTargetShape(AnnouncementDraftTargetRequest target) =>
        target.ChannelId.HasValue
            ? target.GroupId.HasValue && target.WorkspaceId.HasValue
            : target.GroupId.HasValue
                ? target.WorkspaceId.HasValue
                : true;

    private bool TryCurrentActor(out Guid actorUserId, out string? error)
    {
        actorUserId = Guid.Empty;
        error = null;
        if (!currentUser.IsAuthenticated || !currentUser.UserId.HasValue)
        {
            error = "Authentication is required.";
            return false;
        }
        if (!currentTenant.IsAvailable || currentTenant.IsPlatformScope)
        {
            error = "A tenant context is required.";
            return false;
        }
        actorUserId = currentUser.UserId.Value;
        return true;
    }

    private static bool IsValidIdempotencyKey(string? value) =>
        !string.IsNullOrWhiteSpace(value) &&
        value.Trim().Length is >= 8 and <= 128 &&
        value.Trim().All(character => character is >= '!' and <= '~');

    private static string Fingerprint<T>(T request) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request))));

    private static void ClearClaim(AnnouncementDraft draft)
    {
        draft.PublicationClaimOwner = null;
        draft.PublicationClaimToken = null;
        draft.PublicationClaimExpiresAtUtc = null;
    }

    private static AnnouncementDraftResponse ToResponse(AnnouncementDraft draft) => new(
        draft.Id,
        draft.VersionNo,
        draft.Status,
        draft.WorkspaceId,
        draft.GroupId,
        draft.ChannelId,
        draft.Title,
        draft.Body,
        draft.Priority,
        draft.IsPinned,
        draft.RequiresReadConfirmation,
        draft.ExpiresAt,
        draft.ScheduledForUtc,
        draft.ScheduleTimeZoneId,
        draft.ScheduleLocalDateTime,
        draft.ScheduleUtcOffsetMinutes,
        draft.PublishedAnnouncementId,
        draft.PublishedAtUtc,
        draft.LastPublicationFailureCode,
        draft.CreatedAt,
        draft.UpdatedAt);

    private static AnnouncementDraftListItemResponse ToListItem(AnnouncementDraft draft) => new(
        draft.Id,
        draft.VersionNo,
        draft.Status,
        draft.Title,
        draft.ScheduledForUtc,
        draft.ScheduleTimeZoneId,
        draft.PublishedAnnouncementId,
        draft.PublishedAtUtc,
        draft.CreatedAt,
        draft.UpdatedAt);

    private static Result<T> NotFound<T>() => Failure<T>("ANNOUNCEMENT_DRAFT_NOT_FOUND", "Announcement draft not found.");

    private static Result<T> Stale<T>() => Failure<T>("ANNOUNCEMENT_DRAFT_STALE", "Announcement draft has changed. Reload it before retrying.");

    private static Result<T> IdempotencyFailure<T>(string? key) => Failure<T>(
        string.IsNullOrWhiteSpace(key) ? "ANNOUNCEMENT_DRAFT_MISSING_IDEMPOTENCY_KEY" : "ANNOUNCEMENT_DRAFT_INVALID_IDEMPOTENCY_KEY",
        string.IsNullOrWhiteSpace(key) ? "An Idempotency-Key header is required." : "The Idempotency-Key header is invalid.",
        "header.Idempotency-Key");

    private static Result<T> IdempotencyConflict<T>() => Failure<T>(
        "ANNOUNCEMENT_DRAFT_IDEMPOTENCY_CONFLICT",
        "The Idempotency-Key was already used for a different announcement transition.",
        "header.Idempotency-Key");

    private static Result<T> ReplayUnavailable<T>() => Failure<T>(
        "ANNOUNCEMENT_DRAFT_REPLAY_UNAVAILABLE",
        "The announcement transition could not be reconciled. Retry with a new Idempotency-Key.");

    private static Result Failure(string code, string message, string? target = null) =>
        Result.Failure(new ApplicationErrorDetail(code, message, Target: target));

    private static Result<T> Failure<T>(string code, string message, string? target = null) =>
        Result<T>.Failure(new ApplicationErrorDetail(code, message, Target: target));

    private static bool IsConcurrencyConflict(Exception exception) =>
        exception.GetType().Name == "DbUpdateConcurrencyException" ||
        exception.InnerException is not null && IsConcurrencyConflict(exception.InnerException);

    private sealed record ScheduleResolution(
        DateTimeOffset DueAtUtc,
        string TimeZoneId,
        DateTime LocalDateTime,
        int? AmbiguousTimeOffsetMinutes);

    private sealed class AnnouncementTransitionConflictException : Exception
    {
    }

    private sealed class AnnouncementTransitionNotReadyException : Exception
    {
    }

    private sealed class AnnouncementTransitionValidationException(string message) : Exception(message)
    {
    }
}
