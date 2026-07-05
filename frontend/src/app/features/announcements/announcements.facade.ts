import { HttpClient } from '@angular/common/http';
import { inject, Injectable, InjectionToken, signal } from '@angular/core';

import {
  AnnouncementPriority,
  AnnouncementViewModel,
  AnnouncementsPageViewModel,
} from './announcements.types';

export const AIP_ANNOUNCEMENTS_PAGE_MOCK = new InjectionToken<AnnouncementsPageViewModel>(
  'AIP_ANNOUNCEMENTS_PAGE_MOCK',
);

interface PagedResponseDto<T> {
  readonly items?: readonly T[];
}

interface AnnouncementListItemDto {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly priority?: unknown;
  readonly isRead?: unknown;
  readonly requiresReadConfirmation?: unknown;
  readonly publishedAt?: unknown;
}

@Injectable({
  providedIn: 'root',
})
export class AnnouncementsFacade {
  private readonly http = inject(HttpClient);
  private readonly mockPage = inject(AIP_ANNOUNCEMENTS_PAGE_MOCK, { optional: true });
  private readonly pageState = signal<AnnouncementsPageViewModel>(
    this.mockPage ?? this.emptyPage('loading'),
  );

  readonly page = this.pageState.asReadonly();

  constructor() {
    if (!this.mockPage) {
      this.loadAnnouncements();
    }
  }

  private loadAnnouncements(): void {
    this.http
      .get<
        PagedResponseDto<AnnouncementListItemDto>
      >('/api/announcements', { withCredentials: true })
      .subscribe({
        next: (response) => {
          const announcements = (response.items ?? []).map((announcement) =>
            this.toAnnouncement(announcement),
          );
          this.pageState.set({
            ...this.emptyPage(announcements.length === 0 ? 'empty' : 'ready'),
            announcements,
            selectedAnnouncementId: announcements[0]?.id ?? null,
            message:
              announcements.length === 0 ? 'No announcements were returned by the API.' : undefined,
          });
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

  private emptyPage(status: AnnouncementsPageViewModel['status']): AnnouncementsPageViewModel {
    return {
      status,
      title: 'Announcements',
      announcements: [],
      selectedAnnouncementId: null,
      pageCapabilities: [],
    };
  }

  private toAnnouncement(dto: AnnouncementListItemDto): AnnouncementViewModel {
    const id = stringValue(dto.id) ?? '';
    const isRead = dto.isRead === true;

    return {
      id,
      title: stringValue(dto.title) ?? 'Untitled announcement',
      body: 'Detail API has not been loaded for this list item.',
      priority: announcementPriority(dto.priority),
      audienceScope: 'allWorkspaceMembers',
      publishedAtLabel: formatDate(dto.publishedAt),
      publicationState: 'published',
      readState: {
        requiresReadConfirmation: dto.requiresReadConfirmation === true,
        isRead,
      },
      capabilities: ['readAnnouncement'],
      notificationTarget: 'announcementDetail',
      attachment: {
        mode: 'disabled',
        label: 'Attachment API is not implemented for this screen.',
      },
    };
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function formatDate(value: unknown): string {
  const raw = stringValue(value);
  return raw ? new Date(raw).toLocaleString() : '';
}

function announcementPriority(value: unknown): AnnouncementPriority {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized === '1' || normalized === 'important') {
    return 'important';
  }
  if (normalized === '2' || normalized === 'urgent') {
    return 'urgent';
  }
  return 'normal';
}
