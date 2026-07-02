import { inject, Injectable, InjectionToken, signal } from '@angular/core';

import { DEFAULT_ANNOUNCEMENTS_PAGE } from './announcements.mock';
import { AnnouncementsPageViewModel } from './announcements.types';

export const AIP_ANNOUNCEMENTS_PAGE_MOCK = new InjectionToken<AnnouncementsPageViewModel>('AIP_ANNOUNCEMENTS_PAGE_MOCK');

@Injectable({
  providedIn: 'root'
})
export class AnnouncementsFacade {
  private readonly initialPage = inject(AIP_ANNOUNCEMENTS_PAGE_MOCK, { optional: true }) ?? DEFAULT_ANNOUNCEMENTS_PAGE;
  private readonly pageState = signal<AnnouncementsPageViewModel>(this.initialPage);

  readonly page = this.pageState.asReadonly();
}
