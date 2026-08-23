import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { normalizeApiError } from '../../../core/api/api-error.adapter';
import { WorkspacesFacade } from '../workspaces.facade';
import {
  WorkspaceResearchQuickCreateService,
  createQuickResearchIdempotencyKey,
} from '../workspace-research-quick-create.service';

@Component({
  selector: 'app-workspace-research-quick-create-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './workspace-research-quick-create-page.component.html',
  styleUrl: './workspace-research-quick-create-page.component.scss',
})
export class WorkspaceResearchQuickCreatePageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly workspaces = inject(WorkspacesFacade);
  private readonly quickCreate = inject(WorkspaceResearchQuickCreateService);

  readonly workspaceId = this.route.snapshot.paramMap.get('workspaceId') ?? '';
  readonly title = signal('');
  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  private requestIdentity: string | null = null;
  private requestTitle: string | null = null;

  readonly workspace = computed(() =>
    this.workspaces.dashboard().workspaces.find((item) => item.id === this.workspaceId) ?? null,
  );
  readonly canCreateResearch = computed(() =>
    this.workspace()?.capabilities.includes('createProject') === true,
  );

  updateTitle(value: string): void {
    if (this.submitting()) {
      return;
    }

    this.title.set(value);
    this.errorMessage.set(null);
    const normalized = value.trim();
    if (this.requestTitle !== null && normalized !== this.requestTitle) {
      this.requestIdentity = null;
      this.requestTitle = null;
    }
  }

  submit(): void {
    if (this.submitting()) {
      return;
    }

    if (!this.canCreateResearch()) {
      this.errorMessage.set('このWorkspaceでは新しいリサーチを作成できません。');
      return;
    }

    const normalizedTitle = this.title().trim();
    if (!normalizedTitle) {
      this.errorMessage.set('リサーチ名を入力してください。');
      return;
    }
    if (normalizedTitle.length > 200) {
      this.errorMessage.set('リサーチ名は200文字以内で入力してください。');
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
          this.requestIdentity = null;
          this.requestTitle = null;
          void this.router.navigate(['/projects', projectId]);
        },
        error: (error: unknown) => {
          const normalized = normalizeApiError(error);
          this.errorMessage.set(normalized.message);
        },
      });
  }
}
