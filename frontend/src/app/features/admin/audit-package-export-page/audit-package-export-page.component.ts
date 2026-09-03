import { HttpClient, HttpParams } from '@angular/common/http';
import { Component, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { distinctUntilChanged, map, timer } from 'rxjs';

interface AuditPackageSectionPreviewDto {
  readonly key: string;
  readonly label: string;
  readonly itemCount: number;
}

interface AuditPackagePreviewDto {
  readonly artifactId: string;
  readonly artifactVersionId: string;
  readonly artifactVersionNumber: number;
  readonly artifactTitle: string;
  readonly scopeLabel: string;
  readonly canExport: boolean;
  readonly sensitiveMetadataIncluded: boolean;
  readonly sections: readonly AuditPackageSectionPreviewDto[];
}

interface AuditPackageJobDto {
  readonly jobId: string;
  readonly artifactVersionId: string;
  readonly fileName: string;
  readonly state: 'Queued' | 'Processing' | 'Completed' | 'Failed' | string;
  readonly progressPercent: number;
  readonly errorCode?: string | null;
  readonly createdAt: string;
  readonly completedAt?: string | null;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'permissionDenied' | 'notFound' | 'error';

@Component({
  selector: 'app-audit-package-export-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './audit-package-export-page.component.html',
  styleUrl: './audit-package-export-page.component.scss',
})
export class AuditPackageExportPageComponent {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly routeVersion = toSignal(
    this.route.queryParamMap.pipe(
      map((params) => params.get('artifactVersion')),
      distinctUntilChanged(),
    ),
    { initialValue: this.route.snapshot.queryParamMap.get('artifactVersion') },
  );
  private pollSubscription: { unsubscribe(): void } | null = null;
  private requestVersion = 0;

  readonly versionInput = signal(this.route.snapshot.queryParamMap.get('artifactVersion') ?? '');
  readonly loadState = signal<LoadState>('idle');
  readonly preview = signal<AuditPackagePreviewDto | null>(null);
  readonly job = signal<AuditPackageJobDto | null>(null);
  readonly confirmed = signal(false);
  readonly busy = signal(false);
  readonly message = signal<string | null>(null);
  readonly inputError = signal<string | null>(null);

  constructor() {
    effect(() => {
      const artifactVersionId = this.routeVersion();
      untracked(() => this.loadFromRoute(artifactVersionId));
    });
    this.destroyRef.onDestroy(() => this.stopPolling());
  }

  updateVersionInput(value: string): void {
    this.versionInput.set(value);
    if (this.inputError()) {
      this.inputError.set(null);
    }
  }

  openVersion(): void {
    const artifactVersionId = this.versionInput().trim();
    if (!isGuid(artifactVersionId)) {
      this.inputError.set('Enter a valid artifact version ID.');
      return;
    }

    this.inputError.set(null);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { artifactVersion: artifactVersionId },
      queryParamsHandling: 'merge',
    });
  }

  setConfirmed(value: boolean): void {
    this.confirmed.set(value);
  }

  queueExport(): void {
    const preview = this.preview();
    if (!preview || !preview.canExport || !this.confirmed() || this.busy()) {
      return;
    }

    this.busy.set(true);
    this.message.set(null);
    this.http.post<AuditPackageJobDto>(
      '/api/admin/audit/package-exports',
      { artifactVersionId: preview.artifactVersionId },
      { withCredentials: true },
    ).subscribe({
      next: (job) => {
        this.busy.set(false);
        this.job.set(job);
        this.startPolling(job);
      },
      error: (error: { status?: number }) => {
        this.busy.set(false);
        this.message.set(error.status === 401 || error.status === 403
          ? 'Audit export permission is required to create this package.'
          : 'The Audit package export could not be queued.');
      },
    });
  }

  retryExport(): void {
    const current = this.job();
    if (!current || current.state !== 'Failed' || this.busy()) {
      return;
    }

    this.busy.set(true);
    this.message.set(null);
    this.http.post<AuditPackageJobDto>(
      `/api/admin/audit/package-exports/${encodeURIComponent(current.jobId)}/retry`,
      {},
      { withCredentials: true },
    ).subscribe({
      next: (job) => {
        this.busy.set(false);
        this.job.set(job);
        this.startPolling(job);
      },
      error: (error: { status?: number }) => {
        this.busy.set(false);
        this.message.set(error.status === 401 || error.status === 403
          ? 'The package can no longer be retried because export authorization changed.'
          : 'The Audit package retry could not be queued.');
      },
    });
  }

  downloadExport(): void {
    const current = this.job();
    if (!current || current.state !== 'Completed') {
      return;
    }

    const anchor = document.createElement('a');
    anchor.href = `/api/admin/audit/package-exports/${encodeURIComponent(current.jobId)}/download`;
    anchor.rel = 'noopener';
    anchor.click();
  }

  refreshJob(): void {
    const current = this.job();
    if (current) {
      this.fetchJob(current.jobId);
    }
  }

  failureLabel(code: string | null | undefined): string {
    switch (code) {
      case 'AuthorizationChanged': return 'Authorization changed while the package was being generated.';
      case 'ArtifactVersionUnavailable': return 'The artifact version is no longer available.';
      case 'WorkerInterrupted': return 'Processing was interrupted before completion.';
      case 'PackageTooLarge': return 'The package exceeded the current export size limit.';
      case 'StorageWriteFailed': return 'The package could not be written to export storage.';
      case 'ExportJobCorrupt': return 'The export job metadata is invalid.';
      case 'PackageBuildFailed': return 'The package could not be generated.';
      default: return 'The package export failed.';
    }
  }

  formatTimestamp(value: string | null | undefined): string {
    if (!value) {
      return '—';
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
  }

  private loadFromRoute(artifactVersionId: string | null): void {
    this.stopPolling();
    this.requestVersion += 1;
    this.preview.set(null);
    this.job.set(null);
    this.confirmed.set(false);
    this.message.set(null);
    this.versionInput.set(artifactVersionId ?? '');

    if (!artifactVersionId) {
      this.loadState.set('idle');
      this.inputError.set(null);
      return;
    }

    if (!isGuid(artifactVersionId)) {
      this.loadState.set('idle');
      this.inputError.set('Enter a valid artifact version ID.');
      return;
    }

    this.inputError.set(null);
    this.loadPreview(artifactVersionId);
  }

  private loadPreview(artifactVersionId: string): void {
    const requestVersion = ++this.requestVersion;
    this.loadState.set('loading');
    const params = new HttpParams().set('artifactVersionId', artifactVersionId);
    this.http.get<AuditPackagePreviewDto>('/api/admin/audit/package-exports/preview', {
      params,
      withCredentials: true,
    }).subscribe({
      next: (preview) => {
        if (requestVersion !== this.requestVersion) {
          return;
        }
        this.preview.set(preview);
        this.loadState.set('ready');
      },
      error: (error: { status?: number }) => {
        if (requestVersion !== this.requestVersion) {
          return;
        }
        if (error.status === 401 || error.status === 403) {
          this.loadState.set('permissionDenied');
          this.message.set('Audit view permission is required to preview this package.');
          return;
        }
        if (error.status === 404) {
          this.loadState.set('notFound');
          this.message.set('The artifact version is not available in the current authorized scope.');
          return;
        }
        this.loadState.set('error');
        this.message.set('The Audit package preview could not be loaded.');
      },
    });
  }

  private startPolling(job: AuditPackageJobDto): void {
    this.stopPolling();
    if (job.state === 'Completed' || job.state === 'Failed') {
      return;
    }
    this.pollSubscription = timer(1200, 1500).subscribe(() => {
      const current = this.job();
      if (!current || current.state === 'Completed' || current.state === 'Failed') {
        this.stopPolling();
        return;
      }
      this.fetchJob(current.jobId);
    });
  }

  private fetchJob(jobId: string): void {
    this.http.get<AuditPackageJobDto>(
      `/api/admin/audit/package-exports/${encodeURIComponent(jobId)}`,
      { withCredentials: true },
    ).subscribe({
      next: (job) => {
        this.job.set(job);
        if (job.state === 'Completed' || job.state === 'Failed') {
          this.stopPolling();
        }
      },
      error: (error: { status?: number }) => {
        this.stopPolling();
        this.message.set(error.status === 401 || error.status === 403
          ? 'Export authorization changed while checking the job.'
          : 'The export job status could not be refreshed.');
      },
    });
  }

  private stopPolling(): void {
    this.pollSubscription?.unsubscribe();
    this.pollSubscription = null;
  }
}

function isGuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}
