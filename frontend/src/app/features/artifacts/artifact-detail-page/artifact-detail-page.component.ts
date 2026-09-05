import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';

interface ArtifactDetailDto {
  readonly id?: unknown;
  readonly projectId?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly artifactType?: unknown;
  readonly status?: unknown;
  readonly updatedAt?: unknown;
  readonly createdAt?: unknown;
}

interface ArtifactDetailViewModel {
  readonly status: 'loading' | 'ready' | 'unavailable' | 'error';
  readonly title: string;
  readonly description: string;
  readonly artifactType: string;
  readonly artifactStatus: string;
  readonly updatedAt: string;
}

@Component({
  selector: 'app-artifact-detail-page',
  standalone: true,
  template: `
    <main class="artifact-detail" data-testid="artifact-detail-page">
      @let vm = viewModel();
      @if (vm.status === 'loading') {
        <p role="status">Loading artifact…</p>
      } @else if (vm.status === 'ready') {
        <p class="artifact-detail__eyebrow">Artifact</p>
        <h1>{{ vm.title }}</h1>
        @if (vm.description) {
          <p>{{ vm.description }}</p>
        }
        <dl>
          <dt>Type</dt>
          <dd>{{ vm.artifactType }}</dd>
          <dt>Status</dt>
          <dd>{{ vm.artifactStatus }}</dd>
          <dt>Updated</dt>
          <dd>{{ vm.updatedAt }}</dd>
        </dl>
      } @else if (vm.status === 'unavailable') {
        <h1>Artifact unavailable</h1>
        <p>This artifact is no longer available to the current user.</p>
      } @else {
        <h1>Artifact unavailable</h1>
        <p>The artifact could not be loaded.</p>
      }
    </main>
  `,
  styles: [`
    .artifact-detail { display: grid; gap: 1rem; max-width: 56rem; padding: 1.5rem; }
    .artifact-detail__eyebrow { margin: 0; font-size: .75rem; text-transform: uppercase; }
    h1, p, dl { margin: 0; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: .5rem 1rem; }
    dt { font-weight: 600; }
  `],
  changeDetection: ChangeDetectionStrategy.Eager
})
export class ArtifactDetailPageComponent {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  readonly viewModel = signal<ArtifactDetailViewModel>(emptyViewModel('loading'));

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const artifactId = params.get('artifactId');
      if (!artifactId) {
        this.viewModel.set(emptyViewModel('unavailable'));
        return;
      }

      this.loadArtifact(artifactId);
    });
  }

  private loadArtifact(artifactId: string): void {
    this.viewModel.set(emptyViewModel('loading'));
    this.http.get<ArtifactDetailDto>(`/api/artifacts/${encodeURIComponent(artifactId)}`, {
      withCredentials: true
    }).subscribe({
      next: (artifact) => {
        const id = stringValue(artifact.id);
        if (!id || id !== artifactId) {
          this.viewModel.set(emptyViewModel('unavailable'));
          return;
        }

        const updatedAt = stringValue(artifact.updatedAt) ?? stringValue(artifact.createdAt) ?? '';
        this.viewModel.set({
          status: 'ready',
          title: stringValue(artifact.title) ?? 'Artifact',
          description: stringValue(artifact.description) ?? '',
          artifactType: displayValue(artifact.artifactType),
          artifactStatus: displayValue(artifact.status),
          updatedAt: updatedAt ? new Date(updatedAt).toLocaleString() : 'Unknown'
        });
      },
      error: (error: { status?: number }) => {
        this.viewModel.set(emptyViewModel(
          error.status === 401 || error.status === 403 || error.status === 404
            ? 'unavailable'
            : 'error'
        ));
      }
    });
  }
}

function emptyViewModel(status: ArtifactDetailViewModel['status']): ArtifactDetailViewModel {
  return {
    status,
    title: '',
    description: '',
    artifactType: '',
    artifactStatus: '',
    updatedAt: ''
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function displayValue(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return 'Unknown';
}
