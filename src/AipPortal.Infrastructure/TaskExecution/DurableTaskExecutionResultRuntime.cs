using System.Data;
using System.Data.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Files;
using AipPortal.Application.Projects;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace AipPortal.Infrastructure.TaskExecution;

/// <summary>
/// Canonical contest runtime for #462 + #463. It performs current server-side
/// Project-file materialization and commits immutable provenance, one durable
/// report, and the Running -> Succeeded transition in the same transaction.
/// </summary>
public sealed partial class DurableTaskExecutionResultRuntime : ITaskExecutionRuntime
{
    private readonly AppDbContext dbContext;
    private readonly ICurrentTenant currentTenant;
    private readonly IProjectAuthorizationService projectAuthorization;
    private readonly IFileAuthorizationService fileAuthorization;
    private readonly IFileStorageService storage;
    private readonly IClock clock;
    private readonly IAuditLogger audit;

    public DurableTaskExecutionResultRuntime(
        AppDbContext dbContext,
        ICurrentTenant currentTenant,
        IProjectAuthorizationService projectAuthorization,
        IFileAuthorizationService fileAuthorization,
        IFileStorageService storage,
        IClock clock,
        IAuditLogger audit)
    {
        this.dbContext = dbContext;
        this.currentTenant = currentTenant;
        this.projectAuthorization = projectAuthorization;
        this.fileAuthorization = fileAuthorization;
        this.storage = storage;
        this.clock = clock;
        this.audit = audit;
    }

    private const string GenericFailureCode = "TASK_EXECUTION_RESULT_PERSISTENCE_FAILED";
    private const string MissingSourceFailureCode = "TASK_EXECUTION_NO_AUTHORIZED_TEXT_SOURCES";
    private const string IntegrityFailureCode = "TASK_EXECUTION_SOURCE_INTEGRITY_FAILED";
    private const string IncompleteFailureCode = "TASK_EXECUTION_MATERIALIZATION_INCOMPLETE";

    public async Task ExecuteAsync(
        TaskExecutionRuntimeHandle handle,
        CancellationToken cancellationToken = default)
    {
        if (!IsCurrentTenant(handle) || handle.RunId == Guid.Empty)
        {
            return;
        }

        try
        {
            await ExecuteCoreAsync(handle, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            await FailAfterUnexpectedErrorAsync(handle, CancellationToken.None);
        }
    }

    private async Task ExecuteCoreAsync(
        TaskExecutionRuntimeHandle handle,
        CancellationToken cancellationToken)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        var run = await LockRunAsync(handle.RunId, cancellationToken);
        if (!MatchesHandle(run, handle))
        {
            await transaction.RollbackAsync(cancellationToken);
            return;
        }

        if (TaskExecutionRunLifecycle.IsTerminal(run!.Status))
        {
            await transaction.CommitAsync(cancellationToken);
            return;
        }

        if (run.Status == TaskExecutionRunStatus.Accepted)
        {
            run.Status = TaskExecutionRunStatus.Queued;
            run.QueuedAtUtc = clock.UtcNow;
            run.VersionNo++;
            await AuditLifecycleAsync(run, "TaskExecutionRunQueued", cancellationToken);
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        if (run.Status == TaskExecutionRunStatus.Queued)
        {
            run.Status = TaskExecutionRunStatus.Running;
            run.StartedAtUtc = clock.UtcNow;
            run.VersionNo++;
            await AuditLifecycleAsync(run, "TaskExecutionRunStarted", cancellationToken);
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        if (run.Status != TaskExecutionRunStatus.Running)
        {
            await transaction.RollbackAsync(cancellationToken);
            return;
        }

        var eligibility = FirstPartyProjectFilesRuntimeV1.EvaluateScope(
            run.SnapshotWebEnabled,
            run.SnapshotProjectFilesEnabled);
        if (!eligibility.IsEligible)
        {
            await FailRunAsync(run, eligibility.FailureCode ?? GenericFailureCode, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return;
        }

        if (!await IsCurrentRunScopeAuthorizedAsync(run, cancellationToken))
        {
            await FailRunAsync(run, GenericFailureCode, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return;
        }

        var existingResultId = await GetExistingResultIdAsync(run.Id, cancellationToken);
        if (existingResultId.HasValue)
        {
            if (await CountResultSourcesAsync(existingResultId.Value, cancellationToken) <= 0)
            {
                await FailRunAsync(run, IncompleteFailureCode, cancellationToken);
            }
            else
            {
                await SucceedRunAsync(run, existingResultId.Value, null, cancellationToken);
            }

            await transaction.CommitAsync(cancellationToken);
            return;
        }

        var existingProvenance = await LoadExistingProvenanceAsync(run, cancellationToken);
        if (existingProvenance.Count > 0)
        {
            if (!await ReauthorizeExistingProvenanceAsync(run, existingProvenance, cancellationToken))
            {
                await FailRunAsync(run, GenericFailureCode, cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return;
            }

            var completedAt = clock.UtcNow;
            var report = FirstPartyProjectFilesReportV1.Build(
                existingProvenance.Select(item => item.ReportSource).ToArray(),
                completedAt);
            var resultId = await InsertResultAsync(run, report, completedAt, cancellationToken);
            await InsertResultLinksAsync(run, resultId, existingProvenance, cancellationToken);
            await SucceedRunAsync(run, resultId, report, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return;
        }

        var outcome = await MaterializeAsync(run, cancellationToken);
        if (outcome.FailureCode is not null)
        {
            await FailRunAsync(run, outcome.FailureCode, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return;
        }

        if (outcome.Sources.Count == 0)
        {
            await FailRunAsync(run, MissingSourceFailureCode, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return;
        }

        var completionTime = clock.UtcNow;
        var document = FirstPartyProjectFilesReportV1.Build(
            outcome.Sources.Select(item => item.ReportSource).ToArray(),
            completionTime);
        await InsertProvenanceAsync(run, outcome.Sources, cancellationToken);
        var createdResultId = await InsertResultAsync(run, document, completionTime, cancellationToken);
        await InsertResultLinksAsync(run, createdResultId, outcome.Sources, cancellationToken);
        await SucceedRunAsync(run, createdResultId, document, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    private async Task<MaterializationOutcome> MaterializeAsync(
        TaskExecutionRun run,
        CancellationToken cancellationToken)
    {
        var candidates = await dbContext.Set<Attachment>()
            .AsNoTracking()
            .Include(attachment => attachment.FileObject)
            .Where(attachment =>
                attachment.TenantId == run.TenantId &&
                attachment.WorkspaceId == run.WorkspaceId &&
                attachment.OwnerType == AttachmentOwnerType.TaskItem &&
                attachment.OwnerId == run.TaskItemId &&
                !attachment.DeletedAt.HasValue &&
                attachment.ScanStatus == FileScanStatus.Clean &&
                attachment.FileObject != null &&
                attachment.FileObject.TenantId == run.TenantId &&
                attachment.FileObject.WorkspaceId == run.WorkspaceId &&
                attachment.FileObject.ProjectId == run.ProjectId &&
                !attachment.FileObject.DeletedAt.HasValue &&
                attachment.FileObject.Status == FileObjectStatus.Active)
            .OrderBy(attachment => attachment.CreatedAt)
            .ThenBy(attachment => attachment.Id)
            .Take(FirstPartyProjectFilesMaterializationV1.MaxSourceCount)
            .ToListAsync(cancellationToken);

        var sources = new List<RuntimeSource>(candidates.Count);
        var remainingBytes = FirstPartyProjectFilesMaterializationV1.MaxTotalBytes;

        foreach (var candidate in candidates)
        {
            if (remainingBytes <= 0 || candidate.FileObject is not { } fileObject)
            {
                break;
            }

            var mediaType = FirstPartyProjectFilesMaterializationV1
                .NormalizeSupportedMediaType(fileObject.ContentType);
            var maximumForSource = Math.Min(
                FirstPartyProjectFilesMaterializationV1.MaxSourceBytes,
                remainingBytes);
            if (mediaType is null || fileObject.SizeBytes < 0 || fileObject.SizeBytes > maximumForSource)
            {
                continue;
            }

            if (!await fileAuthorization.CanViewAttachment(
                    run.RequestedByUserId,
                    candidate,
                    cancellationToken))
            {
                continue;
            }

            TaskExecutionMaterializedText? materialized;
            try
            {
                await using var stream = await storage.OpenReadAsync(fileObject.StorageKey, cancellationToken);
                materialized = await FirstPartyProjectFilesMaterializationV1.ReadUtf8Async(
                    stream,
                    mediaType,
                    maximumForSource,
                    cancellationToken);
            }
            catch (IOException)
            {
                continue;
            }
            catch (UnauthorizedAccessException)
            {
                continue;
            }
            catch (NotSupportedException)
            {
                continue;
            }

            if (materialized is null)
            {
                continue;
            }

            if (materialized.ByteCount != fileObject.SizeBytes)
            {
                return MaterializationOutcome.Failed(IntegrityFailureCode);
            }

            if (!string.IsNullOrWhiteSpace(fileObject.HashSha256) &&
                !string.Equals(
                    fileObject.HashSha256.Trim(),
                    materialized.ContentSha256,
                    StringComparison.OrdinalIgnoreCase))
            {
                return MaterializationOutcome.Failed(IntegrityFailureCode);
            }

            var current = await CurrentCandidateAsync(candidate.Id, run, cancellationToken);
            if (current?.FileObject is not { } currentFile ||
                !await fileAuthorization.CanViewAttachment(
                    run.RequestedByUserId,
                    current,
                    cancellationToken) ||
                current.FileObjectId != fileObject.Id ||
                !string.Equals(currentFile.StorageKey, fileObject.StorageKey, StringComparison.Ordinal) ||
                currentFile.SizeBytes != fileObject.SizeBytes ||
                !string.Equals(currentFile.ContentType, fileObject.ContentType, StringComparison.OrdinalIgnoreCase) ||
                !string.Equals(currentFile.HashSha256, fileObject.HashSha256, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var provenanceId = Guid.NewGuid();
            var materializedAt = clock.UtcNow;
            sources.Add(new RuntimeSource(
                provenanceId,
                fileObject.Id,
                candidate.Id,
                new TaskExecutionReportSourceInput(
                    provenanceId,
                    materialized.MediaType,
                    materialized.ContentSha256,
                    materialized.ByteCount,
                    materializedAt,
                    materialized.Text)));
            remainingBytes -= checked((int)materialized.ByteCount);
        }

        return MaterializationOutcome.Succeeded(sources);
    }

    private Task<Attachment?> CurrentCandidateAsync(
        Guid attachmentId,
        TaskExecutionRun run,
        CancellationToken cancellationToken) =>
        dbContext.Set<Attachment>()
            .AsNoTracking()
            .Include(attachment => attachment.FileObject)
            .SingleOrDefaultAsync(attachment =>
                attachment.Id == attachmentId &&
                attachment.TenantId == run.TenantId &&
                attachment.WorkspaceId == run.WorkspaceId &&
                attachment.OwnerType == AttachmentOwnerType.TaskItem &&
                attachment.OwnerId == run.TaskItemId &&
                !attachment.DeletedAt.HasValue &&
                attachment.ScanStatus == FileScanStatus.Clean &&
                attachment.FileObject != null &&
                attachment.FileObject.TenantId == run.TenantId &&
                attachment.FileObject.WorkspaceId == run.WorkspaceId &&
                attachment.FileObject.ProjectId == run.ProjectId &&
                !attachment.FileObject.DeletedAt.HasValue &&
                attachment.FileObject.Status == FileObjectStatus.Active,
                cancellationToken);

    private async Task<bool> IsCurrentRunScopeAuthorizedAsync(
        TaskExecutionRun run,
        CancellationToken cancellationToken)
    {
        var projectExists = await dbContext.Set<Project>()
            .AsNoTracking()
            .AnyAsync(project =>
                project.Id == run.ProjectId &&
                project.TenantId == run.TenantId &&
                project.WorkspaceId == run.WorkspaceId &&
                !project.DeletedAt.HasValue,
                cancellationToken);
        if (!projectExists)
        {
            return false;
        }

        var taskExists = await dbContext.Set<TaskItem>()
            .AsNoTracking()
            .AnyAsync(task =>
                task.Id == run.TaskItemId &&
                task.TenantId == run.TenantId &&
                task.WorkspaceId == run.WorkspaceId &&
                task.ProjectId == run.ProjectId &&
                !task.DeletedAt.HasValue,
                cancellationToken);

        return taskExists && await projectAuthorization.CanViewProject(
            run.RequestedByUserId,
            run.ProjectId,
            cancellationToken);
    }

    private async Task<bool> ReauthorizeExistingProvenanceAsync(
        TaskExecutionRun run,
        IReadOnlyList<RuntimeSource> sources,
        CancellationToken cancellationToken)
    {
        foreach (var source in sources)
        {
            var attachment = await CurrentCandidateAsync(source.AttachmentId, run, cancellationToken);
            if (attachment?.FileObject is not { } fileObject ||
                attachment.FileObjectId != source.FileObjectId ||
                (!string.IsNullOrWhiteSpace(fileObject.HashSha256) &&
                 !string.Equals(fileObject.HashSha256.Trim(), source.ReportSource.ContentSha256, StringComparison.OrdinalIgnoreCase)) ||
                !await fileAuthorization.CanViewAttachment(
                    run.RequestedByUserId,
                    attachment,
                    cancellationToken))
            {
                return false;
            }
        }

        return true;
    }
}
