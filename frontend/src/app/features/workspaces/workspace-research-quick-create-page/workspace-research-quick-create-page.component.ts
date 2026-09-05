import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { normalizeApiError } from '../../../core/api/api-error.adapter';
import { WorkspacesFacade } from '../workspaces.facade';
import {
  QuickResearchCreateResponseError,
  WorkspaceResearchQuickCreateService,
  createQuickResearchIdempotencyKey,
} from '../workspace-research-quick-create.service';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-workspace-research-quick-create-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './workspace-research-quick-create-page.component.html',
  styleUrl: './workspace-research-quick-create-page.component.scss',
})
export class WorkspaceResearchQuickCreatePageComponent {
  @ViewChild('titleInput') private titleInput?: ElementRef<HTMLInputElement>;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly workspaces = inject(WorkspacesFacade);
  private readonly quickCreate = inject(WorkspaceResearchQuickCreateService);

  readonly workspaceId = this.route.snapshot.paramMap.get('workspaceId') ?? '';
  readonly title = signal('');
  readonly submitting = signal(false);
  readonly navigating = signal(false);
  readonly createdProjectId = signal<string | null>(null);
  readonly titleError = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);
  private requestIdentity: string | null = null;
  private requestTitle: string | null = null;

  readonly workspace = computed(
    () =>
      this.workspaces.dashboard().workspaces.find((item) => item.id === this.workspaceId) ?? null,
  );
  readonly canCreateResearch = computed(
    () => this.workspace()?.capabilities.includes('createProject') === true,
  );
  readonly busy = computed(() => this.submitting() || this.navigating());

  updateTitle(value: string): void {
    if (this.busy() || this.createdProjectId() !== null) {
      return;
    }

    this.title.set(value);
    this.titleError.set(null);
    this.errorMessage.set(null);
    const normalized = value.trim();
    if (this.requestTitle !== null && normalized !== this.requestTitle) {
      this.requestIdentity = null;
      this.requestTitle = null;
    }
  }

  submit(): void {
    if (this.busy()) {
      return;
    }

    const committedProjectId = this.createdProjectId();
    if (committedProjectId !== null) {
      void this.navigateToCreatedProject(committedProjectId);
      return;
    }

    this.titleError.set(null);
    if (!this.canCreateResearch()) {
      this.errorMessage.set('このWorkspaceでは新しいリサーチを作成できません。');
      return;
    }

    const normalizedTitle = this.title().trim();
    if (!normalizedTitle) {
      this.showTitleError('リサーチ名を入力してください。');
      return;
    }
    if (normalizedTitle.length > 200) {
      this.showTitleError('リサーチ名は200文字以内で入力してください。');
      return;
    }

    if (this.requestTitle !== normalizedTitle || this.requestIdentity === null) {
      this.requestTitle = normalizedTitle;
      this.requestIdentity = createQuickResearchIdempotencyKey();
    }

    const requestIdentity = this.requestIdentity;
    this.submitting.set(true);
    this.errorMessage.set(null);
    this.quickCreate
      .createResearch(this.workspaceId, normalizedTitle, requestIdentity)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.submitting.set(false)),
      )
      .subscribe({
        next: (projectId) => {
          // A verified canonical HTTP 201 has committed this command. From
          // here, recovery is navigation-only and must never post a new key.
          this.requestIdentity = null;
          this.requestTitle = null;
          this.createdProjectId.set(projectId);
          void this.navigateToCreatedProject(projectId);
        },
        error: (error: unknown) => {
          const normalized = normalizeApiError(error);
          if (
            error instanceof QuickResearchCreateResponseError ||
            (normalized.httpStatus >= 200 && normalized.httpStatus < 300)
          ) {
            this.errorMessage.set(
              'リサーチは作成済みの可能性があります。同じ内容で再試行すると安全に確認できます。',
            );
            return;
          }

          this.errorMessage.set(normalized.message);
        },
      });
  }

  private showTitleError(message: string): void {
    this.titleError.set(message);
    this.errorMessage.set(null);
    queueMicrotask(() => this.titleInput?.nativeElement.focus());
  }

  private async navigateToCreatedProject(projectId: string): Promise<void> {
    if (this.navigating()) {
      return;
    }

    this.navigating.set(true);
    this.errorMessage.set(null);
    try {
      const navigated = await this.router.navigate(['/projects', projectId]);
      if (!navigated) {
        this.setCommittedNavigationError();
      }
    } catch {
      this.setCommittedNavigationError();
    } finally {
      this.navigating.set(false);
    }
  }

  private setCommittedNavigationError(): void {
    this.errorMessage.set(
      'リサーチは作成済みです。「作成済みのリサーチを開く」からもう一度開いてください。',
    );
  }
}
