import { Component, EventEmitter, Input, OnChanges, Output, signal, SimpleChanges } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import {
  ANNOUNCEMENT_PRIORITY_LABELS,
  AnnouncementAudienceOption,
  AnnouncementEditorDraft,
  AnnouncementEditorSubmission,
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
  @Output() readonly publishRequested = new EventEmitter<AnnouncementEditorSubmission>();

  readonly priorityOptions: readonly AnnouncementPriority[] = ['normal', 'important', 'critical'];
  readonly priorityLabels = ANNOUNCEMENT_PRIORITY_LABELS;
  readonly availableAudiences = signal<readonly AnnouncementAudienceOption[]>([]);

  readonly form = new FormBuilder().nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(120)]],
    body: ['', [Validators.required, Validators.maxLength(4000)]],
    priority: ['normal' as AnnouncementPriority, Validators.required],
    audienceKey: ['', Validators.required],
    requiresReadConfirmation: [false]
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['draft'] && this.draft) {
      this.availableAudiences.set(this.draft.availableAudiences);
      const authorizedInitialAudienceKey =
        this.draft.availableAudiences.find((audience) => audience.key === this.draft.audienceKey)?.key ??
        this.draft.availableAudiences[0]?.key ??
        '';

      this.form.reset({
        title: this.draft.title,
        body: this.draft.body,
        priority: this.draft.priority,
        audienceKey: authorizedInitialAudienceKey,
        requiresReadConfirmation: this.draft.requiresReadConfirmation
      });
    }
  }

  selectedAudience(): AnnouncementAudienceOption | null {
    const selectedKey = this.form.controls.audienceKey.value;
    return this.availableAudiences().find((audience) => audience.key === selectedKey) ?? null;
  }

  audienceOptionLabel(audience: AnnouncementAudienceOption): string {
    return audience.recipientCount === undefined
      ? audience.displayName
      : `${audience.displayName} — ${audience.recipientCount.toLocaleString('ja-JP')}名`;
  }

  publish(): void {
    const audience = this.selectedAudience();
    if (this.form.invalid || audience === null) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    this.publishRequested.emit({
      title: value.title.trim(),
      body: value.body.trim(),
      priority: value.priority,
      audience,
      requiresReadConfirmation: value.requiresReadConfirmation
    });
  }
}
