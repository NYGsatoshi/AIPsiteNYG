import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { AnnouncementsFacade } from './announcements.facade';

describe('AnnouncementsFacade', () => {
  let facade: AnnouncementsFacade;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    facade = TestBed.inject(AnnouncementsFacade);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  it('treats successful list responses as read-authorized even when capability claims are absent', () => {
    httpMock.expectOne('/api/announcements').flush({
      items: [
        {
          id: 'announcement-1',
          title: 'Authorized notice',
          priority: 'Normal',
          requiresReadConfirmation: false,
          isRead: true,
          publishedAt: '2026-07-07T00:00:00Z',
        },
      ],
    });

    httpMock.expectOne('/api/announcements/announcement-1').flush({
      id: 'announcement-1',
      title: 'Authorized notice',
      body: 'Backend detail',
      priority: 'Normal',
      requiresReadConfirmation: false,
      isRead: true,
      publishedAt: '2026-07-07T00:00:00Z',
    });

    expect(facade.page().status).toBe('ready');
    expect(facade.page().pageCapabilities).toEqual(['readAnnouncement']);
    expect(facade.page().announcements[0].title).toBe('Authorized notice');
  });

  it('loads real detail body for the selected announcement', () => {
    httpMock.expectOne('/api/announcements').flush({
      items: [
        {
          id: 'announcement-1',
          title: 'Authorized notice',
          priority: 'Normal',
          requiresReadConfirmation: false,
          isRead: true,
          publishedAt: '2026-07-07T00:00:00Z',
        },
      ],
    });

    httpMock.expectOne('/api/announcements/announcement-1').flush({
      id: 'announcement-1',
      title: 'Authorized notice',
      body: 'Only the detail endpoint returned this body',
      priority: 'Normal',
      requiresReadConfirmation: false,
      isRead: true,
      publishedAt: '2026-07-07T00:00:00Z',
    });

    expect(facade.page().announcements[0].body).toBe('Only the detail endpoint returned this body');
    expect(facade.page().announcements[0].detailState).toBe('loaded');
  });

  it('shows truthful detail unavailable copy when selected detail cannot be loaded', () => {
    httpMock.expectOne('/api/announcements').flush({
      items: [
        {
          id: 'announcement-1',
          title: 'Authorized notice',
          priority: 'Normal',
          requiresReadConfirmation: false,
          isRead: true,
          publishedAt: '2026-07-07T00:00:00Z',
        },
      ],
    });

    httpMock
      .expectOne('/api/announcements/announcement-1')
      .flush({ error: 'Not found' }, { status: 404, statusText: 'Not Found' });

    expect(facade.page().announcements[0].body).toBe('');
    expect(facade.page().announcements[0].detailState).toBe('unavailable');
    expect(facade.page().announcements[0].detailMessage).toContain('MVP0');
  });
});
