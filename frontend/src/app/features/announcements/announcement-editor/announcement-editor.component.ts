import { Component, Input, OnChanges, signal, SimpleChanges } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import {
  ANNOUNCEMENT_PRIORITY_LABELS,
  AnnouncementAudienceOption,
  AnnouncementAudienceScope,
  AnnouncementEditorDraft,
  AnnouncementPriority
} from '../announcements.types';

@Component({
  selector: 'app-announcement-editor',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './announcement-editor.component.html',
  styleUrl: './announcement-editor.component.scss'
})
export class AnnouncementEditorComponent implements OnChanges {
  @Input({ required: true }) draft!: AnnouncementEditorDraft;

  readonly priorityOptions: readonly AnnouncementPriority[] = ['normal', 'important', 'critical'];
  readonly priorityLabels = ANNOUNCEMENT_PRIORITY_LABELS;
  readonly availableAudiences = signal<readonly AnnouncementAudienceOption[]>([]);

  readonly form = new FormBuilder().nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(120)]],
    body: ['', [Validators.required, Validators.maxLength(4000)]],
    priority: ['normal' as AnnouncementPriority, Validators.required],
    audienceScope: ['allWorkspaceMembers' as AnnouncementAudienceScope, Validators.required],
    requiresReadConfirmation: [false]
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['draft'] && this.draft) {
      this.availableAudiences.set(this.draft.availableAudiences);
      const authorizedInitialAudience =
        this.draft.availableAudiences.find((audience) => audience.scope === this.draft.audienceScope)?.scope ??
        this.draft.availableAudiences[0]?.scope ??
        'allWorkspaceMembers';

      this.form.reset({
        title: this.draft.title,
        body: this.draft.body,
        priority: this.draft.priority,
        audienceScope: authorizedInitialAudience,
        requiresReadConfirmation: this.draft.requiresReadConfirmation
      });
    }
  }

  selectedAudience(): AnnouncementAudienceOption | null {
    const selectedScope = this.form.controls.audienceScope.value;
    return this.availableAudiences().find((audience) => audience.scope === selectedScope) ?? null;
  }

  audienceOptionLabel(audience: AnnouncementAudienceOption): string {
    return audience.recipientCount === undefined
      ? audience.displayName
      : `${audience.displayName} — ${audience.recipientCount.toLocaleString('ja-JP')}名`;
  }
}
