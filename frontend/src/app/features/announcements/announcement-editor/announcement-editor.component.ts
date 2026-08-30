import {
  Component,
  computed,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  signal,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { Subscription } from 'rxjs';

import { AnnouncementLocalPreviewComponent } from '../announcement-local-preview/announcement-local-preview.component';
import { AnnouncementPublicationStatusComponent } from '../announcement-publication-status/announcement-publication-status.component';
import {
  ANNOUNCEMENT_PRIORITY_LABELS,
  AnnouncementAudienceOption,
  AnnouncementEditorDraft,
  AnnouncementEditorSubmission,
  AnnouncementDeliveryMode,
  AnnouncementLocalPreview,
  AnnouncementPriority,
  AnnouncementPublicationState,
} from '../announcements.types';
import { AipDialogComponent } from '../../../shared/ui/aip-dialog/aip-dialog.component';

@Component({
  selector: 'app-announcement-editor',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    AnnouncementPublicationStatusComponent,
    AnnouncementLocalPreviewComponent,
    AipDialogComponent,
  ],
  templateUrl: './announcement-editor.component.html',
  styleUrl: './announcement-editor.component.scss',
})
export class AnnouncementEditorComponent implements OnChanges, OnInit, OnDestroy {
  @ViewChild('titleInput') private titleInput?: ElementRef<HTMLInputElement>;
  @ViewChild('bodyInput') private bodyInput?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('priorityInput') private priorityInput?: ElementRef<HTMLSelectElement>;
  @ViewChild('audienceInput') private audienceInput?: ElementRef<HTMLSelectElement>;
  @ViewChild('scheduleInput') private scheduleInput?: ElementRef<HTMLInputElement>;
  @ViewChild(AnnouncementLocalPreviewComponent)
  private previewComponent?: AnnouncementLocalPreviewComponent;

  @Input({ required: true }) draft!: AnnouncementEditorDraft;
  @Input() submissionError: string | undefined;
  @Input() publishing = false;
  @Output() readonly draftChanged = new EventEmitter<AnnouncementEditorDraft>();
  @Output() readonly saveDraftRequested = new EventEmitter<AnnouncementEditorSubmission>();
  @Output() readonly publishRequested = new EventEmitter<AnnouncementEditorSubmission>();

  readonly priorityOptions: readonly AnnouncementPriority[] = ['normal', 'important', 'critical'];
  readonly priorityLabels = ANNOUNCEMENT_PRIORITY_LABELS;
  readonly availableAudiences = signal<readonly AnnouncementAudienceOption[]>([]);
  readonly previewOpen = signal(false);
  readonly publicationReviewOpen = signal(false);
  readonly publicationConfirming = signal(false);
  readonly publicationReview = signal<AnnouncementEditorSubmission | null>(null);
  private readonly previewRevision = signal(0);
  private submissionAttempted = false;
  private formInitialized = false;
  private formChanges?: Subscription;
  private deliveryModeChanges?: Subscription;

  readonly form = new FormBuilder().nonNullable.group({
    title: [
      '',
      [
        Validators.required,
        nonWhitespaceValidator,
        Validators.maxLength(announcementTitleMaximumLength),
      ],
    ],
    body: [
      '',
      [
        Validators.required,
        nonWhitespaceValidator,
        Validators.maxLength(announcementBodyMaximumLength),
      ],
    ],
    priority: ['normal' as AnnouncementPriority, Validators.required],
    audienceKey: ['', Validators.required],
    requiresReadConfirmation: [false],
    deliveryMode: ['now' as AnnouncementDeliveryMode, Validators.required],
    scheduledLocalDateTime: [''],
    timeZoneId: [browserTimeZoneId()],
  });

  /**
   * This is intentionally a local rendering model, not a DTO or an alternate
   * publication command. The audience is resolved from the current
   * server-authorized options on every change, so a revoked display name/count
   * cannot survive an audience refresh.
   */
  readonly preview = computed<AnnouncementLocalPreview | null>(() => {
    this.previewRevision();
    const audience = this.selectedAudience();
    if (audience === null) {
      return null;
    }

    const value = this.form.getRawValue();
    return {
      title: value.title.trim(),
      body: value.body.trim(),
      priority: value.priority,
      audience,
      requiresReadConfirmation: value.requiresReadConfirmation,
    };
  });

  get publicationState(): AnnouncementPublicationState {
    return this.draft.publicationState ?? 'draft';
  }

  get canPublish(): boolean {
    return this.publicationState === 'draft';
  }

  get canSaveDraft(): boolean {
    return this.publicationState === 'draft';
  }

  get summaryErrors(): readonly AnnouncementEditorFieldError[] {
    if (!this.submissionAttempted) {
      return [];
    }

    return announcementEditorFields
      .map((field) => {
        const message = this.fieldError(field);
        return message ? { field, message } : null;
      })
      .filter((error): error is AnnouncementEditorFieldError => error !== null);
  }

  ngOnInit(): void {
    this.deliveryModeChanges = this.form.controls.deliveryMode.valueChanges.subscribe(() =>
      this.updateScheduleValidators(),
    );
    this.formChanges = this.form.valueChanges.subscribe(() => this.emitDraftChange());
    this.updateScheduleValidators();
  }

  ngOnDestroy(): void {
    this.formChanges?.unsubscribe();
    this.deliveryModeChanges?.unsubscribe();
  }

  ngOnChanges(changes: SimpleChanges): void {
    const submissionErrorChange = changes['submissionError'];
    const publishingChange = changes['publishing'];
    if (
      submissionErrorChange?.currentValue ||
      (publishingChange?.previousValue === true && publishingChange.currentValue === false)
    ) {
      // A failed authoritative request leaves the draft editable. Return from the
      // busy confirmation state before the inline, preserved-draft error renders.
      this.publicationConfirming.set(false);
      this.publicationReviewOpen.set(false);
      this.publicationReview.set(null);
    }

    if (!changes['draft'] || !this.draft) {
      return;
    }

    this.availableAudiences.set(this.draft.availableAudiences);
    this.syncEditability();
    const currentAudienceKey = this.form.controls.audienceKey.value;
    const preferredAudienceKey =
      this.formInitialized && this.form.dirty ? currentAudienceKey : this.draft.audienceKey;
    const authorizedAudienceKey = this.authorizedAudienceKey(preferredAudienceKey);

    if (this.formInitialized && this.form.dirty) {
      if (currentAudienceKey !== authorizedAudienceKey) {
        this.form.controls.audienceKey.setValue(authorizedAudienceKey, { emitEvent: false });
        this.previewRevision.update((revision) => revision + 1);
        // The editor received a new authoritative audience projection. Do not
        // keep an already-open view that might have displayed the revoked
        // audience's name or recipient estimate.
        if (this.previewOpen()) {
          this.closePreview();
        }
      }
      return;
    }

    this.form.reset(
      {
        title: this.draft.title,
        body: this.draft.body,
        priority: this.draft.priority,
        audienceKey: authorizedAudienceKey,
        requiresReadConfirmation: this.draft.requiresReadConfirmation,
        deliveryMode: this.draft.deliveryMode ?? 'now',
        scheduledLocalDateTime: this.draft.scheduledLocalDateTime ?? '',
        timeZoneId: this.draft.timeZoneId ?? browserTimeZoneId(),
      },
      { emitEvent: false },
    );
    this.submissionAttempted = false;
    this.formInitialized = true;
    this.updateScheduleValidators();
    this.previewRevision.update((revision) => revision + 1);

    if (this.previewOpen() && currentAudienceKey !== authorizedAudienceKey) {
      this.closePreview();
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

  fieldError(field: AnnouncementEditorField): string | null {
    const control = this.form.controls[field];
    if (!control.invalid || !control.touched) {
      return null;
    }

    if (field === 'scheduledLocalDateTime') {
      return 'Choose a local date and time before scheduling.';
    }

    if (field === 'title') {
      if (control.hasError('required') || control.hasError('whitespace')) {
        return 'タイトルを入力してください。空白だけでは公開できません。';
      }
      if (control.hasError('maxlength')) {
        return 'タイトルは200文字以内で入力してください。';
      }
    }

    if (field === 'body') {
      if (control.hasError('required') || control.hasError('whitespace')) {
        return '本文を入力してください。空白だけでは公開できません。';
      }
      if (control.hasError('maxlength')) {
        return '本文は20,000文字以内で入力してください。';
      }
    }

    if (field === 'priority') {
      return '優先度を選択してください。';
    }

    return '配信対象を選択してください。権限のある対象のみ公開できます。';
  }

  fieldDescribedBy(field: AnnouncementEditorField, helpId: string): string {
    const errorId = this.fieldError(field)
      ? `announcement-${announcementEditorFieldDomId(field)}-error`
      : null;
    return [helpId, errorId].filter((id): id is string => id !== null).join(' ');
  }

  focusField(field: AnnouncementEditorField, event: Event): void {
    event.preventDefault();
    this.focusControl(field);
  }

  openPreview(): void {
    if (this.preview() === null) {
      this.focusControl('audienceKey');
      return;
    }

    this.previewOpen.set(true);
    // The preview child is created by this state change. Wait for Angular to
    // attach that view before asking its heading to receive keyboard focus.
    setTimeout(() => {
      if (this.previewOpen()) {
        this.previewComponent?.focusHeading();
      }
    });
  }

  closePreview(restoreFocus = true): void {
    this.previewOpen.set(false);
    if (restoreFocus) {
      setTimeout(() => {
        if (!this.previewOpen()) {
          this.focusControl('title');
        }
      });
    }
  }

  publish(): void {
    this.submissionAttempted = true;
    this.form.markAllAsTouched();
    const audience = this.selectedAudience();
    if (!this.canPublish || this.form.invalid || audience === null) {
      this.focusFirstInvalidControl(audience === null ? 'audienceKey' : undefined);
      return;
    }

    const submission = this.createSubmission(true);
    if (submission === null) {
      return;
    }

    this.publicationReview.set(submission);
    this.publicationReviewOpen.set(true);
  }

  saveDraft(): void {
    this.submissionAttempted = true;
    this.form.controls.title.markAsTouched();
    this.form.controls.body.markAsTouched();
    this.form.controls.audienceKey.markAsTouched();
    const submission = this.createSubmission(false);
    if (submission === null || !this.canSaveDraft || this.publishing) {
      return;
    }

    this.saveDraftRequested.emit(submission);
  }

  cancelPublicationReview(): void {
    if (this.publicationConfirming() || this.publishing) {
      return;
    }

    this.publicationReviewOpen.set(false);
    this.publicationReview.set(null);
  }

  confirmPublication(): void {
    const submission = this.publicationReview();
    if (!submission || this.publicationConfirming() || this.publishing) {
      return;
    }

    this.publicationConfirming.set(true);
    this.publishRequested.emit(submission);
  }

  publicationTimingLabel(): string {
    const review = this.publicationReview();
    const mode = review?.deliveryMode ?? this.form.controls.deliveryMode.value;
    if (mode !== 'scheduled') {
      return 'Publish immediately';
    }

    const localDateTime = review?.scheduledLocalDateTime ?? this.form.controls.scheduledLocalDateTime.value;
    const timeZoneId = review?.timeZoneId ?? this.form.controls.timeZoneId.value;
    return localDateTime && timeZoneId
      ? `Schedule for ${localDateTime} (${timeZoneId})`
      : 'Scheduled publication requires a local date, time, and IANA time zone';
  }

  confirmationLabel(): string {
    const recipientCount = this.publicationReview()?.audience.recipientCount;
    const isScheduled = this.publicationReview()?.deliveryMode === 'scheduled';
    if (recipientCount === undefined) {
      return isScheduled ? 'Schedule publication' : 'Publish now';
    }

    return isScheduled
      ? `Schedule for ${recipientCount.toLocaleString('ja-JP')} recipients`
      : `Publish to ${recipientCount.toLocaleString('ja-JP')} recipients now`;
  }

  private authorizedAudienceKey(preferredAudienceKey: string): string {
    return (
      this.draft.availableAudiences.find((audience) => audience.key === preferredAudienceKey)
        ?.key ??
      this.draft.availableAudiences[0]?.key ??
      ''
    );
  }

  private emitDraftChange(): void {
    this.previewRevision.update((revision) => revision + 1);
    const value = this.form.getRawValue();
    this.draftChanged.emit({
      id: this.draft.id,
      version: this.draft.version,
      createIdempotencyKey: this.draft.createIdempotencyKey,
      transitionIdempotencyKey: this.draft.transitionIdempotencyKey,
      title: value.title,
      body: value.body,
      priority: value.priority,
      audienceKey: value.audienceKey,
      availableAudiences: this.availableAudiences(),
      requiresReadConfirmation: value.requiresReadConfirmation,
      deliveryMode: value.deliveryMode,
      scheduledLocalDateTime: value.scheduledLocalDateTime,
      timeZoneId: value.timeZoneId,
      publicationState: this.draft.publicationState,
      scheduledAtLabel: this.draft.scheduledAtLabel,
      timeZoneLabel: this.draft.timeZoneLabel,
    });
  }

  private focusFirstInvalidControl(fallback?: AnnouncementEditorField): void {
    const invalidField =
      announcementEditorFields.find((field) => this.form.controls[field].invalid) ?? fallback;
    if (!invalidField) {
      return;
    }

    queueMicrotask(() => this.focusControl(invalidField));
  }

  private focusControl(field: AnnouncementEditorField): void {
    switch (field) {
      case 'title':
        this.titleInput?.nativeElement.focus();
        break;
      case 'body':
        this.bodyInput?.nativeElement.focus();
        break;
      case 'priority':
        this.priorityInput?.nativeElement.focus();
        break;
      case 'audienceKey':
        this.audienceInput?.nativeElement.focus();
        break;
      case 'scheduledLocalDateTime':
        this.scheduleInput?.nativeElement.focus();
        break;
    }
  }

  private createSubmission(requireSchedule: boolean): AnnouncementEditorSubmission | null {
    const audience = this.selectedAudience();
    const value = this.form.getRawValue();
    const title = value.title.trim();
    const body = value.body.trim();
    if (!title || !body || audience === null) {
      this.focusFirstInvalidControl(!title ? 'title' : !body ? 'body' : 'audienceKey');
      return null;
    }

    const deliveryMode = value.deliveryMode;
    const scheduledLocalDateTime = value.scheduledLocalDateTime.trim();
    const timeZoneId = value.timeZoneId.trim();
    if (requireSchedule && deliveryMode === 'scheduled' && (!scheduledLocalDateTime || !timeZoneId)) {
      this.form.controls.scheduledLocalDateTime.markAsTouched();
      this.form.controls.timeZoneId.markAsTouched();
      this.focusFirstInvalidControl('scheduledLocalDateTime');
      return null;
    }

    return {
      ...(this.draft.id ? { draftId: this.draft.id } : {}),
      ...(this.draft.version !== undefined ? { draftVersion: this.draft.version } : {}),
      ...(this.draft.createIdempotencyKey
        ? { createIdempotencyKey: this.draft.createIdempotencyKey }
        : {}),
      ...(this.draft.transitionIdempotencyKey
        ? { transitionIdempotencyKey: this.draft.transitionIdempotencyKey }
        : {}),
      title,
      body,
      priority: value.priority,
      audience,
      requiresReadConfirmation: value.requiresReadConfirmation,
      deliveryMode,
      ...(deliveryMode === 'scheduled'
        ? { scheduledLocalDateTime, timeZoneId }
        : {}),
    };
  }

  private updateScheduleValidators(): void {
    const scheduled = this.form.controls.deliveryMode.value === 'scheduled';
    this.form.controls.scheduledLocalDateTime.setValidators(scheduled ? [Validators.required] : []);
    this.form.controls.timeZoneId.setValidators(scheduled ? [Validators.required, ianaTimeZoneValidator] : []);
    this.form.controls.scheduledLocalDateTime.updateValueAndValidity({ emitEvent: false });
    this.form.controls.timeZoneId.updateValueAndValidity({ emitEvent: false });
  }

  /**
   * Once the server has accepted a delivery request, the retained draft is a
   * durable schedule rather than editable browser state. It stays visible so
   * the author can see its accepted timing, but no local edit can race the
   * worker's immutable Scheduled -> Published transition.
   */
  private syncEditability(): void {
    if (this.draft.publicationState === 'scheduled' || this.draft.publicationState === 'published') {
      this.form.disable({ emitEvent: false });
      return;
    }

    this.form.enable({ emitEvent: false });
  }
}

type AnnouncementEditorField = 'title' | 'body' | 'priority' | 'audienceKey' | 'scheduledLocalDateTime';

interface AnnouncementEditorFieldError {
  readonly field: AnnouncementEditorField;
  readonly message: string;
}

const announcementEditorFields: readonly AnnouncementEditorField[] = [
  'title',
  'body',
  'priority',
  'audienceKey',
  'scheduledLocalDateTime',
];

const announcementTitleMaximumLength = 200;
const announcementBodyMaximumLength = 20_000;

const announcementEditorFieldDomId = (field: AnnouncementEditorField): string =>
  field === 'audienceKey' ? 'audience' : field === 'scheduledLocalDateTime' ? 'schedule-local-time' : field;

const nonWhitespaceValidator: ValidatorFn = (
  control: AbstractControl<string>,
): ValidationErrors | null => (control.value.trim().length > 0 ? null : { whitespace: true });

const ianaTimeZoneValidator: ValidatorFn = (
  control: AbstractControl<string>,
): ValidationErrors | null => {
  const value = control.value.trim();
  return value === 'UTC' || value.includes('/') ? null : { ianaTimeZone: true };
};

function browserTimeZoneId(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
