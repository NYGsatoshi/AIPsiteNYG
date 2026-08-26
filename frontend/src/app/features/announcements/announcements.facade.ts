import { HttpClient } from '@angular/common/http';
import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { normalizeApiError } from '../../core/api/api-error.adapter';
import {
  ProtectedStateClearReason,
  RealtimeFacade,
} from '../../core/realtime/realtime.facade';
import { DurableRealtimeEvent } from '../../core/realtime/realtime.models';

import {
  AnnouncementAudienceOption,
  AnnouncementCapability,
  AnnouncementEditorDraft,
  AnnouncementEditorSubmission,
  AnnouncementViewModel,
  AnnouncementsPageViewModel,
} from './announcements.types';
import {
  AnnouncementAudienceOptionDto,
  AnnouncementDetailDto,
  AnnouncementListItemDto,
  mapAnnouncementAudienceOption,
  mapAnnouncementDetail,
  mapAnnouncementListItem,
  markAnnouncementDetailLoading,
  markAnnouncementDetailUnavailable,
  markAnnouncementReadConfirmed,
  markAnnouncementReadFailed,
  markAnnouncementReadPending,
  PagedResponseDto,
  toCreateAnnouncementRequest,
} from './announcements.api';

export const AIP_ANNOUNCEMENTS_PAGE_MOCK = new InjectionToken<AnnouncementsPageViewModel>(
  'AIP_ANNOUNCEMENTS_PAGE_MOCK',
);

@Injectable({
  providedIn: 'root',
})
export class AnnouncementsFacade {
  private readonly http = inject(HttpClient);
  private readonly realtime = inject(RealtimeFacade);
  private readonly mockPage = inject(AIP_ANNOUNCEMENTS_PAGE_MOCK, { optional: true });
  private readonly pageState = signal<AnnouncementsPageViewModel>(
    this.mockPage ?? this.emptyPage('loading'),
  );
  private readonly detailRequests = new Set<string>();
  /** Command state is kept outside mapped DTOs so delayed list/detail responses cannot undo it. */
  private readonly readRequests = new Set<string>();
  private readonly readConfirmedIds = new Set<string>();
  private readonly readFailedIds = new Set<string>();
  /** Details reached through an authorized deep link but absent from the current list page. */
  private readonly detailOnlyIds = new Set<string>();
  /** Invalidates callbacks started before a session, tenant, workspace, or authorization boundary. */
  private protectedStateGeneration = 0;
  private readonly protectedRequests = new Set<Subscription>();
  private audienceOptions: readonly AnnouncementAudienceOption[] =
    this.mockPage?.editorDraft?.availableAudiences ?? [];
  private editorActive = false;
  /** A publication has no idempotency contract, so one browser editor permits one in-flight POST. */
  private publicationInFlight = false;
  private editorDraftRevision = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  readonly page = this.pageState.asReadonly();

  constructor() {
    this.realtime.durableEvents$.subscribe((event) => this.handleRealtimeEvent(event));
    if (!this.mockPage) {
      this.realtime.registerProtectedStateClearer?.(
        'announcements',
        (reason) => this.clearProtectedState(reason),
      );
      this.realtime.registerCatchUp('announcements', () => this.loadAnnouncements());
      this.loadAnnouncements();
    }
  }

  setEditorActive(active: boolean): void {
    this.editorActive = active;
  }

  updateEditorDraft(draft: AnnouncementEditorDraft): void {
    if (!this.pageState().editorDraft) {
      return;
    }

    this.editorDraftRevision += 1;
    this.pageState.update((page) => ({
      ...page,
      editorDraft: this.createDraft(this.audienceOptions, draft),
    }));
  }

  beginCreate(): boolean {
    if (this.audienceOptions.length === 0) {
      return false;
    }

    this.editorActive = true;
    this.pageState.update((page) => ({
      ...page,
      editorDraft: this.createDraft(this.audienceOptions),
      message: undefined,
      editorError: undefined,
      isPublishing: false,
    }));
    return true;
  }

  createAnnouncement(submission: AnnouncementEditorSubmission): void {
    const draftRevisionAtSubmission = this.editorDraftRevision;
    const authorizedAudience = this.audienceOptions.find(
      (audience) => audience.key === submission.audience.key,
    );
    if (!authorizedAudience) {
      this.preserveSubmissionAsDraft(
        submission,
        audienceAuthorizationChangedMessage,
        draftRevisionAtSubmission,
      );
      this.loadAudienceOptions();
      return;
    }

    if (this.publicationInFlight) {
      return;
    }

    this.publicationInFlight = true;
    this.pageState.update((page) => ({ ...page, isPublishing: true }));

    const authorizedSubmission: AnnouncementEditorSubmission = {
      ...submission,
      audience: authorizedAudience,
    };

    if (this.mockPage) {
      const created = this.mockCreatedAnnouncement(authorizedSubmission);
      this.publicationInFlight = false;
      this.pageState.update((page) => ({
        ...page,
        status: 'ready',
        announcements: [created, ...page.announcements],
        selectedAnnouncementId: created.id,
        editorDraft: undefined,
        message: 'お知らせを公開しました。',
        editorError: undefined,
        isPublishing: false,
      }));
      this.editorActive = false;
      return;
    }

    const generation = this.protectedStateGeneration;
    const request = this.http
      .post<AnnouncementDetailDto>(
        '/api/announcements',
        toCreateAnnouncementRequest(authorizedSubmission),
        {
          withCredentials: true,
        },
      )
      .subscribe({
        next: (response) => {
          if (!this.isCurrentProtectedGeneration(generation)) {
            return;
          }
          this.publicationInFlight = false;
          const created = mapAnnouncementDetail(response);
          this.pageState.update((page) => ({
            ...page,
            status: 'ready',
            announcements: [
              created,
              ...page.announcements.filter((announcement) => announcement.id !== created.id),
            ],
            selectedAnnouncementId: created.id,
            editorDraft: undefined,
            message: 'お知らせを公開しました。',
            editorError: undefined,
            isPublishing: false,
          }));
          this.editorActive = false;
        },
        error: (error: unknown) => {
          if (!this.isCurrentProtectedGeneration(generation)) {
            return;
          }
          this.publicationInFlight = false;
          this.pageState.update((page) => ({ ...page, isPublishing: false }));
          if (this.isAudienceAuthorizationFailure(error)) {
            this.preserveSubmissionAsDraft(
              authorizedSubmission,
              audienceAuthorizationChangedMessage,
              draftRevisionAtSubmission,
            );
            this.loadAudienceOptions();
            return;
          }

          this.preserveSubmissionAsDraft(
            authorizedSubmission,
            publicationUnavailableMessage,
            draftRevisionAtSubmission,
          );
        },
      });
    this.trackProtectedRequest(request);
  }

  private loadAnnouncements(): void {
    const generation = this.protectedStateGeneration;
    const request = this.http
      .get<PagedResponseDto<AnnouncementListItemDto>>('/api/announcements', {
        withCredentials: true,
      })
      .subscribe({
        next: (response) => {
          if (!this.isCurrentProtectedGeneration(generation)) {
            return;
          }
          // A refresh can have started immediately before the user opened the
          // editor. Its authoritative list data is still safe to apply, but
          // it must never replace that local, unsubmitted create draft.
          const activeDraft = this.editorActive ? this.pageState().editorDraft : undefined;
          const activeEditorError = activeDraft ? this.pageState().editorError : undefined;
          const isPublishing = activeDraft ? this.pageState().isPublishing : false;
          const listedAnnouncements = (response.items ?? []).map((announcement) =>
            this.reconcileReadActionState(mapAnnouncementListItem(announcement)),
          );
          const selectedAnnouncementId =
            this.pageState().selectedAnnouncementId ?? listedAnnouncements[0]?.id ?? null;
          const selectedDetail = selectedAnnouncementId
            ? this.findAnnouncement(selectedAnnouncementId)
            : undefined;
          const preserveSelectedDetail =
            selectedAnnouncementId !== null &&
            selectedDetail?.detailState === 'loaded' &&
            this.detailOnlyIds.has(selectedAnnouncementId) &&
            !listedAnnouncements.some((announcement) => announcement.id === selectedAnnouncementId);
          const announcements = preserveSelectedDetail
            ? [...listedAnnouncements, this.reconcileReadActionState(selectedDetail!)]
            : listedAnnouncements;
          if (selectedAnnouncementId && !preserveSelectedDetail) {
            this.detailOnlyIds.delete(selectedAnnouncementId);
          }
          this.pageState.set({
            ...this.emptyPage(announcements.length === 0 ? 'empty' : 'ready'),
            announcements,
            selectedAnnouncementId,
            editorDraft: activeDraft,
            editorError: activeEditorError,
            isPublishing,
            pageCapabilities: announcements.length > 0 ? ['readAnnouncement'] : [],
            message:
              announcements.length === 0 ? '表示できるお知らせはまだありません。' : undefined,
          });
          this.loadAudienceOptions(generation);
          if (selectedAnnouncementId) {
            this.selectAnnouncement(selectedAnnouncementId, {
              forceRefresh: preserveSelectedDetail,
              keepLoadedContent: preserveSelectedDetail,
            });
          }
        },
        error: (error: { status?: number }) => {
          if (!this.isCurrentProtectedGeneration(generation)) {
            return;
          }
          this.pageState.set({
            ...this.emptyPage(
              error.status === 401 || error.status === 403 ? 'permissionDenied' : 'error',
            ),
            message:
              error.status === 401 || error.status === 403
                ? 'Authentication or announcement permission is required.'
                : 'Announcement API request failed.',
          });
        },
      });
    this.trackProtectedRequest(request);
  }

  private loadAudienceOptions(generation = this.protectedStateGeneration): void {
    const request = this.http
      .get<readonly AnnouncementAudienceOptionDto[]>('/api/announcements/audiences', {
        withCredentials: true,
      })
      .subscribe({
        next: (response) => {
          if (!this.isCurrentProtectedGeneration(generation)) {
            return;
          }
          this.audienceOptions = response
            .map((option) => mapAnnouncementAudienceOption(option))
            .filter((option): option is AnnouncementAudienceOption => option !== null);
          this.pageState.update((page) => ({
            ...page,
            pageCapabilities: this.withCreateCapability(
              page.pageCapabilities,
              this.audienceOptions.length > 0,
            ),
            editorDraft: page.editorDraft
              ? this.createDraft(this.audienceOptions, page.editorDraft)
              : undefined,
          }));
        },
        error: () => {
          if (!this.isCurrentProtectedGeneration(generation)) {
            return;
          }
          this.audienceOptions = [];
          this.pageState.update((page) => ({
            ...page,
            pageCapabilities: this.withCreateCapability(page.pageCapabilities, false),
            editorDraft: page.editorDraft ? this.createDraft([], page.editorDraft) : undefined,
            message: page.editorDraft
              ? undefined
              : '配信対象を安全に取得できないため、新規公開を無効化しました。',
            editorError: page.editorDraft
              ? (page.editorError ??
                '配信対象を安全に取得できないため、新規公開を無効化しました。入力内容は保持されています。')
              : undefined,
          }));
        },
      });
    this.trackProtectedRequest(request);
  }

  private handleRealtimeEvent(event: DurableRealtimeEvent): void {
    if (this.mockPage || event.eventType !== 'Announcements.AnnouncementChanged.v1') {
      return;
    }

    if (this.editorActive) {
      this.pageState.update((page) => ({
        ...page,
        message:
          'An announcement changed elsewhere. Your draft was preserved; reload before publishing.',
      }));
      return;
    }

    if (this.refreshTimer !== null) {
      return;
    }
    const generation = this.protectedStateGeneration;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      if (!this.isCurrentProtectedGeneration(generation)) {
        return;
      }

      // The event may have arrived just before a user opened the editor. Do
      // not let the deferred list response replace that new, local draft.
      // The editor is already told that it needs a fresh review before the
      // one immediate publication command is sent.
      if (this.editorActive) {
        this.pageState.update((page) => ({
          ...page,
          message:
            'An announcement changed elsewhere. Your draft was preserved; reload before publishing.',
        }));
        return;
      }

      this.loadAnnouncements();
    }, 100);
  }

  selectAnnouncement(
    announcementId: string,
    options: { readonly forceRefresh?: boolean; readonly keepLoadedContent?: boolean } = {},
  ): void {
    this.pageState.update((page) => ({ ...page, selectedAnnouncementId: announcementId }));
    if (!announcementId || this.mockPage || this.detailRequests.has(announcementId)) {
      return;
    }

    const current = this.findAnnouncement(announcementId);
    if (current?.detailState === 'loaded' && !options.forceRefresh) {
      return;
    }

    this.detailRequests.add(announcementId);
    if (current && !options.keepLoadedContent) {
      this.replaceAnnouncement(markAnnouncementDetailLoading(current));
    }

    const generation = this.protectedStateGeneration;
    const request = this.http
      .get<AnnouncementDetailDto>(`/api/announcements/${announcementId}`, { withCredentials: true })
      .subscribe({
        next: (detail) => {
          if (!this.isCurrentProtectedGeneration(generation)) {
            return;
          }
          this.detailRequests.delete(announcementId);
          const mappedDetail = this.reconcileReadActionState(mapAnnouncementDetail(detail));
          if (!this.findAnnouncement(announcementId)) {
            this.detailOnlyIds.add(announcementId);
          }
          this.upsertAnnouncement(mappedDetail);
        },
        error: (error: { status?: number }) => {
          if (!this.isCurrentProtectedGeneration(generation)) {
            return;
          }
          this.detailRequests.delete(announcementId);
          const announcement = this.findAnnouncement(announcementId);
          if (!announcement) {
            return;
          }

          if (this.detailOnlyIds.delete(announcementId)) {
            this.removeAnnouncement(announcementId);
            return;
          }

          this.replaceAnnouncement(
            markAnnouncementDetailUnavailable(
              announcement,
              error.status === 404
                ? '詳細はMVP0では利用できません。'
                : 'Announcement detail API request failed.',
            ),
          );
        },
      });
    this.trackProtectedRequest(request);
  }

  markAnnouncementRead(announcementId: string): void {
    const announcement = this.findAnnouncement(announcementId);
    if (
      !announcementId ||
      !announcement ||
      announcement.readState.isRead ||
      this.readRequests.has(announcementId)
    ) {
      return;
    }

    this.readFailedIds.delete(announcementId);
    this.readRequests.add(announcementId);
    this.replaceAnnouncement(markAnnouncementReadPending(announcement));

    if (this.mockPage) {
      this.readRequests.delete(announcementId);
      this.readConfirmedIds.add(announcementId);
      const current = this.findAnnouncement(announcementId);
      if (current) this.replaceAnnouncement(markAnnouncementReadConfirmed(current));
      return;
    }

    const generation = this.protectedStateGeneration;
    const request = this.http
      .post(`/api/announcements/${announcementId}/read`, {}, { withCredentials: true })
      .subscribe({
        next: () => {
          if (!this.isCurrentProtectedGeneration(generation)) {
            return;
          }
          this.readRequests.delete(announcementId);
          this.readConfirmedIds.add(announcementId);
          this.readFailedIds.delete(announcementId);
          const current = this.findAnnouncement(announcementId);
          if (current) this.replaceAnnouncement(markAnnouncementReadConfirmed(current));
        },
        error: () => {
          if (!this.isCurrentProtectedGeneration(generation)) {
            return;
          }
          this.readRequests.delete(announcementId);
          this.readFailedIds.add(announcementId);
          const current = this.findAnnouncement(announcementId);
          if (current) this.replaceAnnouncement(markAnnouncementReadFailed(current));
        },
      });
    this.trackProtectedRequest(request);
  }

  private createDraft(
    audiences: readonly AnnouncementAudienceOption[],
    previous?: AnnouncementEditorDraft,
  ): AnnouncementEditorDraft {
    const previousAudienceKey = previous?.audienceKey;
    const audienceKey =
      audiences.find((audience) => audience.key === previousAudienceKey)?.key ??
      audiences[0]?.key ??
      '';
    return {
      id: previous?.id,
      title: previous?.title ?? '',
      body: previous?.body ?? '',
      priority: previous?.priority ?? 'normal',
      audienceKey,
      availableAudiences: audiences,
      requiresReadConfirmation: previous?.requiresReadConfirmation ?? false,
      publicationState: previous?.publicationState ?? 'draft',
      scheduledAtLabel: previous?.scheduledAtLabel,
      timeZoneLabel: previous?.timeZoneLabel,
    };
  }

  private preserveSubmissionAsDraft(
    submission: AnnouncementEditorSubmission,
    message: string,
    draftRevisionAtSubmission: number,
  ): void {
    const submittedDraft: AnnouncementEditorDraft = {
      title: submission.title,
      body: submission.body,
      priority: submission.priority,
      audienceKey: submission.audience.key,
      availableAudiences: this.audienceOptions,
      requiresReadConfirmation: submission.requiresReadConfirmation,
    };
    this.pageState.update((page) => {
      const currentDraft =
        this.editorDraftRevision > draftRevisionAtSubmission && page.editorDraft
          ? page.editorDraft
          : submittedDraft;
      return {
        ...page,
        editorDraft: this.createDraft(this.audienceOptions, currentDraft),
        editorError: message,
      };
    });
  }

  private isAudienceAuthorizationFailure(error: unknown): boolean {
    const normalized = normalizeApiError(error);
    return (
      normalized.httpStatus === 400 &&
      normalized.message === 'Announcement audience is not authorized.'
    );
  }

  private withCreateCapability(
    capabilities: readonly AnnouncementCapability[],
    canCreate: boolean,
  ): readonly AnnouncementCapability[] {
    const withoutCreate = capabilities.filter((capability) => capability !== 'createAnnouncement');
    return canCreate ? [...withoutCreate, 'createAnnouncement'] : withoutCreate;
  }

  private mockCreatedAnnouncement(submission: AnnouncementEditorSubmission): AnnouncementViewModel {
    return {
      id: `mock-created-${Date.now()}`,
      title: submission.title,
      body: submission.body,
      detailState: 'loaded',
      priority: submission.priority,
      audienceScope: submission.audience.scope,
      publishedAtLabel: new Date().toLocaleString(),
      publicationState: 'published',
      readState: {
        requiresReadConfirmation: submission.requiresReadConfirmation,
        isRead: true,
        isMarkingRead: false,
      },
      capabilities: ['readAnnouncement', 'editAnnouncement'],
      notificationTarget: 'announcementDetail',
    };
  }

  private emptyPage(status: AnnouncementsPageViewModel['status']): AnnouncementsPageViewModel {
    return {
      status,
      title: 'Announcements',
      announcements: [],
      selectedAnnouncementId: null,
      pageCapabilities: [],
      isPublishing: false,
    };
  }

  private findAnnouncement(announcementId: string): AnnouncementViewModel | undefined {
    return this.pageState().announcements.find(
      (announcement) => announcement.id === announcementId,
    );
  }

  private replaceAnnouncement(nextAnnouncement: AnnouncementViewModel): void {
    this.pageState.update((page) => ({
      ...page,
      announcements: page.announcements.map((announcement) =>
        announcement.id === nextAnnouncement.id ? nextAnnouncement : announcement,
      ),
    }));
  }

  private upsertAnnouncement(nextAnnouncement: AnnouncementViewModel): void {
    this.pageState.update((page) => {
      const hasAnnouncement = page.announcements.some(
        (announcement) => announcement.id === nextAnnouncement.id,
      );
      return {
        ...page,
        status: page.status === 'empty' || page.status === 'loading' ? 'ready' : page.status,
        announcements: hasAnnouncement
          ? page.announcements.map((announcement) =>
              announcement.id === nextAnnouncement.id ? nextAnnouncement : announcement,
            )
          : [...page.announcements, nextAnnouncement],
        pageCapabilities: page.pageCapabilities.includes('readAnnouncement')
          ? page.pageCapabilities
          : [...page.pageCapabilities, 'readAnnouncement'],
        message: page.status === 'empty' ? undefined : page.message,
      };
    });
  }

  private removeAnnouncement(announcementId: string): void {
    this.pageState.update((page) => ({
      ...page,
      announcements: page.announcements.filter((announcement) => announcement.id !== announcementId),
    }));
  }

  private isCurrentProtectedGeneration(generation: number): boolean {
    return generation === this.protectedStateGeneration;
  }

  private trackProtectedRequest(request: Subscription): void {
    this.protectedRequests.add(request);
    request.add(() => this.protectedRequests.delete(request));
  }

  private cancelProtectedRequests(): void {
    for (const request of [...this.protectedRequests]) {
      request.unsubscribe();
    }
    this.protectedRequests.clear();
  }

  private clearProtectedState(_reason: ProtectedStateClearReason): void {
    // A boundary may race list, detail, audience, or mutation callbacks. Ignore
    // all prior responses before clearing their protected projections.
    this.protectedStateGeneration += 1;
    this.cancelProtectedRequests();
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.detailRequests.clear();
    this.readRequests.clear();
    this.readConfirmedIds.clear();
    this.readFailedIds.clear();
    this.detailOnlyIds.clear();
    this.audienceOptions = [];
    this.editorActive = false;
    this.publicationInFlight = false;
    this.editorDraftRevision += 1;
    this.pageState.set(this.emptyPage('loading'));
  }

  private reconcileReadActionState(announcement: AnnouncementViewModel): AnnouncementViewModel {
    const announcementId = announcement.id;
    if (!announcementId) {
      return announcement;
    }

    if (announcement.readState.isRead) {
      this.readConfirmedIds.delete(announcementId);
      this.readFailedIds.delete(announcementId);
      return announcement;
    }

    if (this.readRequests.has(announcementId)) {
      return markAnnouncementReadPending(announcement);
    }

    if (this.readConfirmedIds.has(announcementId)) {
      return markAnnouncementReadConfirmed(announcement);
    }

    if (this.readFailedIds.has(announcementId)) {
      return markAnnouncementReadFailed(announcement);
    }

    return announcement;
  }
}

const audienceAuthorizationChangedMessage =
  'The selected audience is no longer authorized. Review the current audience options before publishing.';
const publicationUnavailableMessage =
  'The announcement could not be published right now. Your draft is still available; try again.';
