using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Realtime;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Projects;

/// <summary>
/// Owns Task-bound Research Plan revisions. The Task Brief and execution source
/// policy remain separate Task contracts; this service never invokes execution.
/// </summary>
public sealed class ResearchPlanService(
    IProjectRepository projects,
    IProjectAuthorizationService projectAuthorization,
    IResearchPlanRepository researchPlans,
    ICurrentUser currentUser,
    IClock clock,
    IAuditLogger audit,
    IBusinessInvalidationPublisher invalidations,
    ITaskCommandUnitOfWork unitOfWork) : IResearchPlanService
{
    private const int MaximumSteps = 100;
    private const int MaximumTitleLength = 240;
    private const int MaximumObjectiveLength = 4_000;
    private const int MaximumScopeSummaryLength = 4_000;

    public async Task<Result<ResearchPlanResponse>> GetAsync(
        Guid taskItemId,
        CancellationToken cancellationToken = default)
    {
        var task = await VisibleTaskAsync(taskItemId, cancellationToken);
        if (task is null)
            return NotFound<ResearchPlanResponse>();

        var plan = await researchPlans.GetForTaskAsync(task.Id, cancellationToken);
        var canManage = await CanManageAsync(task.ProjectId, cancellationToken);
        return Result<ResearchPlanResponse>.Success(
            await BuildResponseAsync(plan, canManage, cancellationToken));
    }

    public async Task<Result<ResearchPlanResponse>> ReplaceAsync(
        Guid taskItemId,
        ReplaceResearchPlanRequest request,
        CancellationToken cancellationToken = default)
    {
        var task = await ManagedTaskAsync(taskItemId, cancellationToken);
        if (task is null)
            return NotFound<ResearchPlanResponse>();

        if (!TryNormalizeSteps(request.Steps, out var steps, out var failure))
            return Result<ResearchPlanResponse>.Failure(failure!);

        if (request.ExpectedVersion < 0)
            return Invalid<ResearchPlanResponse>("expectedVersion", "Expected version must be zero or a positive integer.");

        var plan = await researchPlans.GetForTaskForUpdateAsync(task.Id, cancellationToken);
        if (plan is null && request.ExpectedVersion != 0)
            return Stale<ResearchPlanResponse>();
        if (plan is not null && plan.VersionNo != request.ExpectedVersion)
            return Stale<ResearchPlanResponse>();

        var actor = Actor();
        if (plan is null)
        {
            plan = new ResearchPlan
            {
                TenantId = task.TenantId,
                WorkspaceId = task.WorkspaceId,
                ProjectId = task.ProjectId,
                TaskItemId = task.Id,
                VersionNo = 1
            };
            await researchPlans.AddPlanAsync(plan, cancellationToken);
        }
        else
        {
            plan.VersionNo = NextVersion(plan.VersionNo);
        }

        var priorRevisionNo = await researchPlans.GetLatestRevisionNumberAsync(plan.Id, cancellationToken);
        var revision = new ResearchPlanRevision
        {
            TenantId = task.TenantId,
            WorkspaceId = task.WorkspaceId,
            ProjectId = task.ProjectId,
            TaskItemId = task.Id,
            ResearchPlanId = plan.Id,
            RevisionNo = NextRevisionNo(priorRevisionNo),
            CreatedByUserId = actor,
            CreatedAtUtc = clock.UtcNow
        };
        var snapshotSteps = steps.Select((step, index) => new ResearchPlanStep
        {
            TenantId = task.TenantId,
            WorkspaceId = task.WorkspaceId,
            ProjectId = task.ProjectId,
            TaskItemId = task.Id,
            ResearchPlanId = plan.Id,
            ResearchPlanRevisionId = revision.Id,
            SortOrder = index + 1,
            Title = step.Title,
            Objective = step.Objective,
            ScopeSummary = step.ScopeSummary,
            Status = step.Status
        }).ToArray();

        plan.CurrentRevisionId = revision.Id;
        await researchPlans.AddRevisionAsync(revision, cancellationToken);
        await researchPlans.AddStepsAsync(snapshotSteps, cancellationToken);
        AdvanceTaskVersion(task);

        await audit.LogAsync(new AuditLogEntry(
            actor,
            "ResearchPlanRevisionSaved",
            "ResearchPlanRevision",
            revision.Id,
            WorkspaceId: task.WorkspaceId,
            ProjectId: task.ProjectId,
            Metadata: new Dictionary<string, object?>
            {
                ["planId"] = plan.Id,
                ["revisionNo"] = revision.RevisionNo,
                ["stepCount"] = snapshotSteps.Length,
                ["planVersion"] = plan.VersionNo
            }), cancellationToken);
        await invalidations.TaskChangedAsync(
            task,
            actor,
            "researchPlanChanged",
            ["researchPlan"],
            cancellationToken: cancellationToken);

        var save = await unitOfWork.SaveTaskCommandAsync(cancellationToken);
        if (!save.IsSaved)
            return Stale<ResearchPlanResponse>();

        return Result<ResearchPlanResponse>.Success(
            new ResearchPlanResponse(plan.Id, plan.VersionNo, ToRevisionResponse(revision, snapshotSteps), true));
    }

    private async Task<ResearchPlanResponse> BuildResponseAsync(
        ResearchPlan? plan,
        bool canManage,
        CancellationToken cancellationToken)
    {
        if (plan is null || !plan.CurrentRevisionId.HasValue)
            return new ResearchPlanResponse(plan?.Id, plan?.VersionNo ?? 0, null, canManage);

        var revision = await researchPlans.GetRevisionAsync(plan.Id, plan.CurrentRevisionId.Value, cancellationToken);
        return new ResearchPlanResponse(
            plan.Id,
            plan.VersionNo,
            revision is null ? null : ToRevisionResponse(revision, revision.Steps),
            canManage);
    }

    private async Task<TaskItem?> VisibleTaskAsync(Guid taskItemId, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actor) || taskItemId == Guid.Empty)
            return null;

        var task = await projects.GetTaskAsync(taskItemId, cancellationToken);
        return task is { DeletedAt: null } &&
               await projectAuthorization.CanViewProject(actor, task.ProjectId, cancellationToken)
            ? task
            : null;
    }

    private async Task<TaskItem?> ManagedTaskAsync(Guid taskItemId, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actor) || taskItemId == Guid.Empty)
            return null;

        var task = await projects.GetTaskAsync(taskItemId, cancellationToken);
        return task is { DeletedAt: null } &&
               await projectAuthorization.CanManageProject(actor, task.ProjectId, cancellationToken)
            ? task
            : null;
    }

    private async Task<bool> CanManageAsync(Guid projectId, CancellationToken cancellationToken) =>
        TryActor(out var actor) && await projectAuthorization.CanManageProject(actor, projectId, cancellationToken);

    private bool TryActor(out Guid actor)
    {
        actor = currentUser.UserId ?? Guid.Empty;
        return currentUser.IsAuthenticated && actor != Guid.Empty;
    }

    private Guid Actor() => currentUser.UserId ?? Guid.Empty;

    private static bool TryNormalizeSteps(
        IReadOnlyList<ResearchPlanStepRequest>? source,
        out IReadOnlyList<NormalizedStep> normalized,
        out ApplicationErrorDetail? failure)
    {
        normalized = [];
        failure = null;
        if (source is null || source.Count > MaximumSteps)
        {
            failure = new ApplicationErrorDetail(
                "RESEARCH_PLAN_VALIDATION_FAILED",
                $"A Research Plan may contain at most {MaximumSteps} steps.",
                Target: "steps");
            return false;
        }

        var items = new List<NormalizedStep>(source.Count);
        for (var index = 0; index < source.Count; index++)
        {
            var step = source[index];
            if (step is null)
            {
                failure = InvalidStep(index, "A step is required.");
                return false;
            }

            var title = step.Title?.Trim();
            if (string.IsNullOrWhiteSpace(title) || title.Length > MaximumTitleLength)
            {
                failure = InvalidStep(index, $"Title is required and may contain at most {MaximumTitleLength} characters.", "title");
                return false;
            }

            var objective = step.Objective?.Trim() ?? string.Empty;
            if (objective.Length > MaximumObjectiveLength)
            {
                failure = InvalidStep(index, $"Objective may contain at most {MaximumObjectiveLength} characters.", "objective");
                return false;
            }

            var scopeSummary = step.ScopeSummary?.Trim() ?? string.Empty;
            if (scopeSummary.Length > MaximumScopeSummaryLength)
            {
                failure = InvalidStep(index, $"Scope summary may contain at most {MaximumScopeSummaryLength} characters.", "scopeSummary");
                return false;
            }

            if (!Enum.IsDefined(step.Status))
            {
                failure = InvalidStep(index, "Step status is invalid.", "status");
                return false;
            }

            items.Add(new NormalizedStep(title, objective, scopeSummary, step.Status));
        }

        normalized = items;
        return true;
    }

    private static ResearchPlanRevisionResponse ToRevisionResponse(
        ResearchPlanRevision revision,
        IEnumerable<ResearchPlanStep> steps) =>
        new(
            revision.Id,
            checked((int)revision.RevisionNo),
            revision.CreatedAtUtc,
            revision.CreatedByUserId,
            steps
                .OrderBy(step => step.SortOrder)
                .ThenBy(step => step.Id)
                .Select(step => new ResearchPlanStepResponse(
                    step.Id,
                    step.SortOrder,
                    step.Title,
                    step.Objective,
                    step.ScopeSummary,
                    step.Status))
                .ToArray());

    private static ApplicationErrorDetail InvalidStep(int index, string message, string? field = null) =>
        new(
            "RESEARCH_PLAN_VALIDATION_FAILED",
            message,
            Target: field is null ? $"steps[{index}]" : $"steps[{index}].{field}");

    private static long NextRevisionNo(long? prior) => Math.Max(1L, checked((prior ?? 0) + 1L));
    private static long NextVersion(long value) => Math.Max(1L, checked(value + 1L));
    private static void AdvanceTaskVersion(TaskItem task) => task.VersionNo = NextVersion(task.VersionNo);

    private static Result<T> Invalid<T>(string target, string message) =>
        Result<T>.Failure(new ApplicationErrorDetail("RESEARCH_PLAN_VALIDATION_FAILED", message, Target: target));

    private static Result<T> Stale<T>() =>
        Result<T>.Failure(new ApplicationErrorDetail(
            "RESEARCH_PLAN_STALE_VERSION",
            "The Research Plan has changed. Refetch and retry."));

    private static Result<T> NotFound<T>() =>
        Result<T>.Failure(new ApplicationErrorDetail(
            "RESEARCH_PLAN_NOT_FOUND",
            "The requested resource was not found."));

    private sealed record NormalizedStep(
        string Title,
        string Objective,
        string ScopeSummary,
        ResearchPlanStepStatus Status);
}
