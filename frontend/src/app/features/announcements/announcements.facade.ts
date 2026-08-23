import { HttpClient } from '@angular/common/http';
import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { RealtimeFacade } from '../../core/realtime/realtime.facade';
import { DurableRealtimeEvent } from '../../core/realtime/realtime.models';

import {
  AnnouncementAudienceOption,
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
  private audienceOptions: readonly AnnouncementAudienceOption[] = this.mockPage?.editorDraft?.availableAudiences ?? [];
  private editorActive = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  readonly page = this.pageState.asReadonly();

  constructor() {
    this.realtime.durableEvents$.subscribe((event) => this.handleRealtimeEvent(event));
    if (!this.mockPage) {
      this.loadAnnouncements();
    }
  }

  setEditorActive(active: boolean): void {
    this.editorActive = active;
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
    }));
    return true;
  }

  createAnnouncement(submission: AnnouncementEditorSubmission): void {
    const authorizedAudience = this.audienceOptions.find((audience) => audience.key === submission.audience.key);
    if (!authorizedAudience) {
      this.pageState.update((page) => ({
        ...page,
        message: '配信対象の権限が変更されました。対象を再読み込みして確認してください。',
      }));
      return;
    }

    const authorizedSubmission: AnnouncementEditorSubmission = {
      ...submission,
      audience: authorizedAudience,
    };

    if (this.mockPage) {
      const created = this.mockCreatedAnnouncement(authorizedSubmission);
      this.pageState.update((page) => ({
        ...page,
        status: 'ready',
        announcements: [created, ...page.announcements],
        selectedAnnouncementId: created.id,
        editorDraft: undefined,
        message: undefined,
      }));
      this.editorActive = false;
      return;
    }

    this.http
      .post<AnnouncementDetailDto>('/api/announcements', toCreateAnnouncementRequest(authorizedSubmission), {
        withCredentials: true,
      })
      .subscribe({
        next: (response) => {
          const created = mapAnnouncementDetail(response);
          this.pageState.update((page) => ({
            ...page,
            status: 'ready',
            announcements: [created, ...page.announcements.filter((announcement) => announcement.id !== created.id)],
            selectedAnnouncementId: created.id,
            editorDraft: undefined,
            message: undefined,
          }));
          this.editorActive = false;
        },
        error: () => {
          this.pageState.update((page) => ({
            ...page,
            message: '公開できませんでした。配信対象の権限が変更された可能性があります。対象を再確認してください。',
          }));
          this.loadAudienceOptions();
        },
      });
  }

  private loadAnnouncements(): void {
    this.http
      .get<PagedResponseDto<AnnouncementListItemDto>>('/api/announcements', { withCredentials: true })
      .subscribe({
        next: (response) => {
          const announcements = (response.items ?? []).map((announcement) =>
            mapAnnouncementListItem(announcement),
          );
          const selectedAnnouncementId =
            this.pageState().selectedAnnouncementId ?? announcements[0]?.id ?? null;
          this.pageState.set({
            ...this.emptyPage(announcements.length === 0 ? 'empty' : 'ready'),
            announcements,
            selectedAnnouncementId,
            pageCapabilities: announcements.length > 0 ? ['readAnnouncement'] : [],
            message:
              announcements.length === 0 ? '表示できるお知らせはまだありません。' : undefined,
          });
          this.loadAudienceOptions();
          if (selectedAnnouncementId) {
            this.selectAnnouncement(selectedAnnouncementId);
          }
        },
        error: (error: { status?: number }) => {
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
  }

  private loadAudienceOptions(): void {
    this.http
      .get<readonly AnnouncementAudienceOptionDto[]>('/api/announcements/audiences', { withCredentials: true })
      .subscribe({
        next: (response) => {
          this.audienceOptions = response
            .map((option) => mapAnnouncementAudienceOption(option))
            .filter((option): option is AnnouncementAudienceOption => option !== null);
          this.pageState.update((page) => ({
            ...page,
            pageCapabilities: this.withCreateCapability(page.pageCapabilities, this.audienceOptions.length > 0),
            editorDraft: page.editorDraft
              ? this.createDraft(this.audienceOptions, page.editorDraft)
              : undefined,
          }));
        },
        error: () => {
          this.audienceOptions = [];
          this.pageState.update((page) => ({
            ...page,
            pageCapabilities: this.withCreateCapability(page.pageCapabilities, false),
            editorDraft: undefined,
            message: page.message ?? '配信対象を安全に取得できないため、新規公開を無効化しました。',
          }));
        },
      });
  }

  private handleRealtimeEvent(event: DurableRealtimeEvent): void {
    if (this.mockPage || event.eventType !== 'Announcements.AnnouncementChanged.v1') {
      return;
    }

    if (this.editorActive) {
      this.pageState.update((page) => ({
        ...page,
        message: 'An announcement changed elsewhere. Your draft was preserved; reload before publishing.'
      }));
      return;
    }

    if (this.refreshTimer !== null) {
      return;
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.loadAnnouncements();
    }, 100);
  }

  selectAnnouncement(announcementId: string): void {
    this.pageState.update((page) => ({ ...page, selectedAnnouncementId: announcementId }));
    if (!announcementId || this.mockPage || this.detailRequests.has(announcementId)) {
      return;
    }

    const current = this.findAnnouncement(announcementId);
    if (current?.detailState === 'loaded') {
      return;
    }

    this.detailRequests.add(announcementId);
    if (current) {
      this.replaceAnnouncement(markAnnouncementDetailLoading(current));
    }

    this.http
      .get<AnnouncementDetailDto>(`/api/announcements/${announcementId}`, { withCredentials: true })
      .subscribe({
        next: (detail) => {
          this.detailRequests.delete(announcementId);
          this.replaceAnnouncement(mapAnnouncementDetail(detail));
        },
        error: (error: { status?: number }) => {
          this.detailRequests.delete(announcementId);
          const announcement = this.findAnnouncement(announcementId);
          if (!announcement) {
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
  }

  markAnnouncementRead(announcementId: string): void {
    if (!announcementId) {
      return;
    }

    if (this.mockPage) {
      const announcement = this.findAnnouncement(announcementId);
      if (announcement) {
        this.replaceAnnouncement(markAnnouncementReadConfirmed(announcement, new Date().toLocaleString()));
      }
      return;
    }

    this.http
      .post(`/api/announcements/${announcementId}/read`, {}, { withCredentials: true })
      .subscribe({
        next: () => {
          const announcement = this.findAnnouncement(announcementId);
          if (announcement) {
            this.replaceAnnouncement(markAnnouncementReadConfirmed(announcement, new Date().toLocaleString()));
          }
        },
        error: () => {
          // Keep read state unchanged unless the backend confirms persistence.
        },
      });
  }

  private createDraft(
    audiences: readonly AnnouncementAudienceOption[],
    previous?: AnnouncementEditorDraft,
  ): AnnouncementEditorDraft {
    const previousAudienceKey = previous?.audienceKey;
    const audienceKey =
      audiences.find((audience) => audience.key === previousAudienceKey)?.key ?? audiences[0]?.key ?? '';
    return {
      title: previous?.title ?? '',
      body: previous?.body ?? '',
      priority: previous?.priority ?? 'normal',
      audienceKey,
      availableAudiences: audiences,
      requiresReadConfirmation: previous?.requiresReadConfirmation ?? false,
    };
  }

  private withCreateCapability(
    capabilities: readonly AnnouncementsPageViewModel['pageCapabilities'][number][],
    canCreate: boolean,
  ): readonly AnnouncementsPageViewModel['pageCapabilities'][number][] {
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
        confirmedAtLabel: '公開済み',
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
    };
  }

  private findAnnouncement(announcementId: string): AnnouncementViewModel | undefined {
    return this.pageState().announcements.find((announcement) => announcement.id === announcementId);
  }

  private replaceAnnouncement(nextAnnouncement: AnnouncementViewModel): void {
    this.pageState.update((page) => ({
      ...page,
      announcements: page.announcements.map((announcement) =>
        announcement.id === nextAnnouncement.id ? nextAnnouncement : announcement,
      ),
    }));
  }
}
