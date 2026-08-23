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
    httpMock.expectOne('/api/announcements/audiences').flush([]);

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
    httpMock.expectOne('/api/announcements/audiences').flush([]);

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
    httpMock.expectOne('/api/announcements/audiences').flush([]);

    httpMock
      .expectOne('/api/announcements/announcement-1')
      .flush({ error: 'Not found' }, { status: 404, statusText: 'Not Found' });

    expect(facade.page().announcements[0].body).toBe('');
    expect(facade.page().announcements[0].detailState).toBe('unavailable');
    expect(facade.page().announcements[0].detailMessage).toContain('MVP0');
  });

  it('enables create only from authorized audience options and posts the reviewed ids', () => {
    const workspaceId = '11111111-1111-1111-1111-111111111111';
    const groupId = '22222222-2222-2222-2222-222222222222';

    httpMock.expectOne('/api/announcements').flush({ items: [] });
    httpMock.expectOne('/api/announcements/audiences').flush([
      {
        key: `group:${groupId}`,
        scopeType: 'group',
        workspaceId,
        groupId,
        channelId: null,
        displayName: 'School / Teachers',
        estimatedRecipientCount: 86,
      },
    ]);

    expect(facade.page().pageCapabilities).toContain('createAnnouncement');
    expect(facade.beginCreate()).toBe(true);
    const audience = facade.page().editorDraft?.availableAudiences[0];
    expect(audience?.displayName).toBe('School / Teachers');

    facade.createAnnouncement({
      title: 'Safety update',
      body: 'Review this announcement',
      priority: 'important',
      audience: audience!,
      requiresReadConfirmation: true,
    });

    const createRequest = httpMock.expectOne('/api/announcements');
    expect(createRequest.request.method).toBe('POST');
    expect(createRequest.request.body).toEqual({
      workspaceId,
      groupId,
      channelId: null,
      title: 'Safety update',
      body: 'Review this announcement',
      priority: 1,
      isPinned: false,
      requiresReadConfirmation: true,
    });
    createRequest.flush({
      id: 'announcement-created',
      workspaceId,
      groupId,
      channelId: null,
      title: 'Safety update',
      body: 'Review this announcement',
      priority: 1,
      requiresReadConfirmation: true,
      isRead: false,
      publishedAt: '2026-08-23T10:00:00Z',
    });

    expect(facade.page().status).toBe('ready');
    expect(facade.page().selectedAnnouncementId).toBe('announcement-created');
    expect(facade.page().editorDraft).toBeUndefined();
    expect(facade.page().announcements[0].audienceScope).toBe('group');
  });

  it('preserves the draft and disables publish when server authorization changes', () => {
    const workspaceId = '11111111-1111-1111-1111-111111111111';
    const audienceDto = {
      key: `workspace:${workspaceId}`,
      scopeType: 'workspace',
      workspaceId,
      groupId: null,
      channelId: null,
      displayName: 'School',
      estimatedRecipientCount: 1248,
    };

    httpMock.expectOne('/api/announcements').flush({ items: [] });
    httpMock.expectOne('/api/announcements/audiences').flush([audienceDto]);
    expect(facade.beginCreate()).toBe(true);
    const audience = facade.page().editorDraft!.availableAudiences[0];

    facade.createAnnouncement({
      title: 'Preserved title',
      body: 'Preserved body',
      priority: 'critical',
      audience,
      requiresReadConfirmation: true,
    });

    httpMock
      .expectOne('/api/announcements')
      .flush({ error: 'not authorized' }, { status: 400, statusText: 'Bad Request' });
    httpMock.expectOne('/api/announcements/audiences').flush([]);

    expect(facade.page().editorDraft).toMatchObject({
      title: 'Preserved title',
      body: 'Preserved body',
      priority: 'critical',
      publicationState: 'draft',
      audienceKey: '',
      availableAudiences: [],
      requiresReadConfirmation: true,
    });
    expect(facade.page().pageCapabilities).not.toContain('createAnnouncement');
    expect(facade.page().message).toContain('対象を再確認');
  });

  it('fails closed when authorized audience loading fails', () => {
    httpMock.expectOne('/api/announcements').flush({ items: [] });
    httpMock
      .expectOne('/api/announcements/audiences')
      .flush({ error: 'Unavailable' }, { status: 503, statusText: 'Unavailable' });

    expect(facade.page().pageCapabilities).not.toContain('createAnnouncement');
    expect(facade.beginCreate()).toBe(false);
    expect(facade.page().message).toContain('新規公開を無効化');
  });
});
