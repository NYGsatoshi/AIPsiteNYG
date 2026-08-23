import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import {
  ANNOUNCEMENT_AUDIENCE_LABELS,
  ANNOUNCEMENT_PRIORITY_LABELS,
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
  readonly audienceOptions: readonly AnnouncementAudienceScope[] = [
    'allWorkspaceMembers',
    'guardiansOnly',
    'teachersOnly',
    'adminOnly'
  ];
  readonly priorityLabels = ANNOUNCEMENT_PRIORITY_LABELS;
  readonly audienceLabels = ANNOUNCEMENT_AUDIENCE_LABELS;

  readonly form = new FormBuilder().nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(120)]],
    body: ['', [Validators.required, Validators.maxLength(4000)]],
    priority: ['normal' as AnnouncementPriority, Validators.required],
    audienceScope: ['allWorkspaceMembers' as AnnouncementAudienceScope, Validators.required],
    requiresReadConfirmation: [false]
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['draft'] && this.draft) {
      this.form.reset({
        title: this.draft.title,
        body: this.draft.body,
        priority: this.draft.priority,
        audienceScope: this.draft.audienceScope,
        requiresReadConfirmation: this.draft.requiresReadConfirmation
      });
    }
  }
}
