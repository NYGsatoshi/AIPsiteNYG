/* eslint-disable max-lines -- Issue #390 extends the existing route/editor page; structural cleanup remains part of ESLINT-01. */
import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnDestroy,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { AnnouncementAnalyticsPanelComponent } from '../announcement-analytics-panel/announcement-analytics-panel.component';
import { AnnouncementDetailComponent } from '../announcement-detail/announcement-detail.component';
import { AnnouncementEngagementClient } from '../announcement-engagement.client';
import { AnnouncementMultiAudienceEditorComponent } from '../announcement-multi-audience-editor/announcement-multi-audience-editor.component';
import { AnnouncementListComponent } from '../announcement-list/announcement-list.component';
import { AnnouncementNavigationStateService } from '../announcement-navigation-state.service';
import { AnnouncementsFacade } from '../announcements.facade';
import {
  ANNOUNCEMENT_PUBLICATION_STATE_LABELS,
  AnnouncementEditorDraft,
  AnnouncementEditorSubmission,
  AnnouncementViewModel,
} from '../announcements.types';

@Component({
  selector: 'app-announcements-page',
  standalone: true,
  imports: [
    FormsModule,
    AnnouncementAnalyticsPanelComponent,
    AnnouncementDetailComponent,
    AnnouncementMultiAudienceEditorComponent,
    AnnouncementListComponent,
  ],
  templateUrl: './announcements-page.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './announcements-page.component.scss',
})
export class AnnouncementsPageComponent implements OnDestroy {
  private readonly facade = inject(AnnouncementsFacade);
  private readonly engagement = inject(AnnouncementEngagementClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly navigationState = inject(AnnouncementNavigationStateService);
  private readonly routeAnnouncementId = signal<string | null>(null);

  readonly page = this.facade.page;
  readonly searchValue = signal('');
  readonly selectedAnnouncementId = signal<string | null>(
    this.route.snapshot.paramMap.get('announcementId') ?? this.page().selectedAnnouncementId,
  );
  readonly detailRouteActive = computed(() => this.routeAnnouncementId() !== null);
  readonly detailFocusRequest = signal(0);
  readonly listFocusRequest = signal(0);
  readonly listFocusAnnouncementId = signal<string | null>(null);
  readonly editorVisible = signal(false);
  readonly editingAnnouncementId = signal<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/member-ordering -- Issue #390 state is kept adjacent to the existing page state.
  public readonly acknowledgedAnnouncementId = signal<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/member-ordering -- Issue #390 state is kept adjacent to the existing page state.
  public readonly acknowledgementPendingId = signal<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/member-ordering -- Issue #390 state is kept adjacent to the existing page state.
  public readonly acknowledgementFailedId = signal<string | null>(null);

  readonly filteredAnnouncements = computed(() =>
    this.filterAuthorizedAnnouncements(this.page().announcements, this.searchValue()),
  );
  readonly selectedAnnouncement = computed(() => {
    const routeAnnouncementId = this.routeAnnouncementId();
    if (routeAnnouncementId) {
      return (
        this.filteredAnnouncements().find(
          (announcement) => announcement.id === routeAnnouncementId,
        ) ?? null
      );
    }

    const selectedId = this.selectedAnnouncementId() ?? this.page().selectedAnnouncementId;
    if (selectedId) {
      return (
        this.filteredAnnouncements().find((announcement) => announcement.id === selectedId) ?? null
      );
    }

    return this.filteredAnnouncements()[0] ?? null;
  });

  readonly hasReadPermission = computed(() =>
    this.page().pageCapabilities.includes('readAnnouncement'),
  );
  readonly canCreate = computed(() => this.page().pageCapabilities.includes('createAnnouncement'));
  readonly canEdit = computed(() => this.page().pageCapabilities.includes('editAnnouncement'));
  readonly activeEditorDraft = computed<AnnouncementEditorDraft | null>(() => {
    const editingId = this.editingAnnouncementId();
    if (!editingId) {
      return this.page().editorDraft ?? null;
    }

    const announcement = this.page().announcements.find((item) => item.id === editingId);
    if (!announcement) {
      return null;
    }

    const availableAudiences = this.page().editorDraft?.availableAudiences ?? [];
    const matchingAudiences = availableAudiences.filter(
      (audience) => audience.scope === announcement.audienceScope,
    );
    const audienceKey = matchingAudiences.length === 1 ? matchingAudiences[0].key : '';

    return {
      id: announcement.id,
      title: announcement.title,
      body: announcement.body,
      priority: announcement.priority,
      audienceKey,
      audienceKeys: audienceKey ? [audienceKey] : [],
      availableAudiences,
      requiresReadConfirmation: announcement.readState.requiresReadConfirmation,
      publicationState: announcement.publicationState,
      scheduledAtLabel: announcement.scheduledAtLabel,
      timeZoneLabel: announcement.timeZoneLabel,
    };
  });

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((paramMap) => {
      const announcementId = paramMap.get('announcementId');
      const previousRouteAnnouncementId = this.routeAnnouncementId();
      this.routeAnnouncementId.set(announcementId);
      this.resetEngagementActionStateForRouteChange(announcementId, previousRouteAnnouncementId);

      if (announcementId) {
        this.selectedAnnouncementId.set(announcementId);
        this.facade.selectAnnouncement(announcementId);
        if (announcementId !== previousRouteAnnouncementId) {
          this.navigationState.resetDetailScroll(() =>
            this.detailFocusRequest.update((request) => request + 1),
          );
        }
      } else if (previousRouteAnnouncementId || this.navigationState.hasPendingListState()) {
        this.navigationState.restoreListState((originAnnouncementId) => {
          this.listFocusAnnouncementId.set(originAnnouncementId);
          this.listFocusRequest.update((request) => request + 1);
        });
      }
    });
  }

  selectAnnouncement(announcementId: string): void {
    if (!announcementId) {
      return;
    }

    if (this.selectedAnnouncementId() !== announcementId) {
      this.resetEngagementActionState();
    }
    this.navigationState.rememberListState(announcementId);
    this.selectedAnnouncementId.set(announcementId);
    this.editorVisible.set(false);
    this.editingAnnouncementId.set(null);
    this.facade.setEditorActive(false);
    if (this.routeAnnouncementId() === announcementId) {
      this.facade.selectAnnouncement(announcementId);
      return;
    }

    void this.router.navigate(['/announcements', announcementId]).catch(() => undefined);
  }

  returnToList(): void {
    if (!this.detailRouteActive()) {
      return;
    }

    this.navigationState.rememberListHeadingFallback();
    void this.router.navigate(['/announcements'], { replaceUrl: true }).catch(() => undefined);
  }

  markRead(announcementId: string): void {
    this.facade.markAnnouncementRead(announcementId);
  }

  public acknowledge(announcementId: string): void {
    const announcement = this.page().announcements.find((item) => item.id === announcementId);
    if (
      typeof announcement === 'undefined' ||
      !announcement.readState.requiresReadConfirmation ||
      this.acknowledgedAnnouncementId() === announcementId ||
      this.acknowledgementPendingId() === announcementId
    ) {
      return;
    }

    this.acknowledgementPendingId.set(announcementId);
    this.acknowledgementFailedId.set(null);
    this.engagement
      .acknowledge(announcementId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: () => {
          if (this.acknowledgementPendingId() !== announcementId) {
            return;
          }
          this.acknowledgementPendingId.set(null);
          this.acknowledgementFailedId.set(announcementId);
        },
        next: () => {
          if (this.acknowledgementPendingId() !== announcementId) {
            return;
          }
          this.acknowledgementPendingId.set(null);
          this.acknowledgedAnnouncementId.set(announcementId);
          if (!announcement.readState.isRead) {
            /*
             * The acknowledgement endpoint already persists the read state.
             * Replaying the idempotent read command synchronizes the existing
             * facade projection without introducing a second source of truth.
             */
            this.facade.markAnnouncementRead(announcementId);
          }
        },
      });
  }

  public trackCtaClick(announcementId: string): void {
    const announcement = this.page().announcements.find((item) => item.id === announcementId);
    if (typeof announcement === 'undefined') {
      return;
    }
    if (typeof announcement.cta === 'undefined') {
      return;
    }

    /*
     * The CTA remains a normal safe link. Tracking is best-effort and never
     * blocks or rewrites the recipient-visible destination.
     */
    this.engagement
      .trackCtaClick(announcementId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: () => {
          /* Best-effort telemetry deliberately does not block navigation. */
        },
      });
  }

  public isAcknowledged(announcementId: string): boolean {
    return this.acknowledgedAnnouncementId() === announcementId;
  }

  public isAcknowledgementPending(announcementId: string): boolean {
    return this.acknowledgementPendingId() === announcementId;
  }

  public hasAcknowledgementError(announcementId: string): boolean {
    return this.acknowledgementFailedId() === announcementId;
  }

  updateSearch(value: string): void {
    this.searchValue.set(value);
  }

  showCreateEditor(): void {
    // The button is rendered from the page capability, but a background list
    // refresh can replace that projection between pointer-down and click. The
    // facade owns the current authorized audience set, so beginCreate() is the
    // final fail-closed authority for whether the editor may actually open.
    if (this.facade.beginCreate()) {
      this.editingAnnouncementId.set(null);
      this.editorVisible.set(true);
    }
  }

  showEditEditor(): void {
    const selected = this.selectedAnnouncement();
    if (this.canEdit() && selected && selected.publicationState !== 'archived') {
      this.editingAnnouncementId.set(selected.id);
      this.editorVisible.set(true);
      this.facade.setEditorActive(true);
    }
  }

  publishAnnouncement(submission: AnnouncementEditorSubmission): void {
    // Existing-announcement mutation remains a separate contract, so never
    // reinterpret an edit action as a new durable draft delivery request.
    if (this.editingAnnouncementId() !== null) {
      return;
    }
    this.facade.createAnnouncement(submission);
  }

  saveAnnouncementDraft(submission: AnnouncementEditorSubmission): void {
    if (this.editingAnnouncementId() !== null) {
      return;
    }
    this.facade.saveAnnouncementDraft(submission);
  }

  updateAnnouncementDraft(draft: AnnouncementEditorDraft): void {
    if (this.editingAnnouncementId() === null) {
      this.facade.updateEditorDraft(draft);
    }
  }

  ngOnDestroy(): void {
    this.facade.setEditorActive(false);
  }

  private resetEngagementActionStateForRouteChange(
    announcementId: string | null,
    previousRouteAnnouncementId: string | null,
  ): void {
    if (announcementId !== null && announcementId !== previousRouteAnnouncementId) {
      this.resetEngagementActionState();
    }
  }

  private resetEngagementActionState(): void {
    this.acknowledgedAnnouncementId.set(null);
    this.acknowledgementPendingId.set(null);
    this.acknowledgementFailedId.set(null);
  }

  private filterAuthorizedAnnouncements(
    announcements: readonly AnnouncementViewModel[],
    searchValue: string,
  ): readonly AnnouncementViewModel[] {
    const readableAnnouncements = announcements.filter((announcement) =>
      announcement.capabilities.includes('readAnnouncement'),
    );
    const query = searchValue.trim().toLocaleLowerCase('ja-JP');

    if (!query) {
      return readableAnnouncements;
    }

    return readableAnnouncements.filter((announcement) =>
      [
        announcement.title,
        announcement.body,
        announcement.publishedAtLabel,
        announcement.expiresAtLabel ?? '',
        announcement.scheduledAtLabel ?? '',
        announcement.timeZoneLabel ?? '',
        ANNOUNCEMENT_PUBLICATION_STATE_LABELS[announcement.publicationState],
      ]
        .join(' ')
        .toLocaleLowerCase('ja-JP')
        .includes(query),
    );
  }
}
