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
    expect(facade.page().editorError).toBeUndefined();
    expect(facade.page().message).toBe('お知らせを公開しました。');
    expect(facade.page().announcements[0].audienceScope).toBe('group');
  });

  it('preserves the draft and disables publish after a confirmed audience authorization change', () => {
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
      .flush(
        { error: 'Announcement audience is not authorized.' },
        { status: 400, statusText: 'Bad Request' },
      );
    httpMock.expectOne('/api/announcements/audiences').flush([]);

    expect(facade.page().editorDraft).toEqual({
      id: undefined,
      title: 'Preserved title',
      body: 'Preserved body',
      priority: 'critical',
      audienceKey: '',
      availableAudiences: [],
      requiresReadConfirmation: true,
      publicationState: 'draft',
      scheduledAtLabel: undefined,
      timeZoneLabel: undefined,
    });
    expect(facade.page().pageCapabilities).not.toContain('createAnnouncement');
    expect(facade.page().message).toBeUndefined();
    expect(facade.page().editorError).toContain('selected audience is no longer authorized');
    expect(facade.page().editorError).not.toContain('Announcement audience is not authorized.');
  });

  it('preserves live edits while a delayed audience authorization refresh resolves', () => {
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
      title: 'Submitted title',
      body: 'Submitted body',
      priority: 'normal',
      audience,
      requiresReadConfirmation: false,
    });

    httpMock
      .expectOne('/api/announcements')
      .flush(
        { error: 'Announcement audience is not authorized.' },
        { status: 400, statusText: 'Bad Request' },
      );
    const audienceRefresh = httpMock.expectOne('/api/announcements/audiences');

    facade.updateEditorDraft({
      ...facade.page().editorDraft!,
      title: 'Live title edited after publish failed',
      body: 'Live body edited after publish failed',
    });
    audienceRefresh.flush([]);

    expect(facade.page().editorDraft).toMatchObject({
      title: 'Live title edited after publish failed',
      body: 'Live body edited after publish failed',
      audienceKey: '',
      availableAudiences: [],
    });
    expect(facade.page().pageCapabilities).not.toContain('createAnnouncement');
  });

  it('preserves edits made while an audience authorization publish response is still in flight', () => {
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
      title: 'Submitted title',
      body: 'Submitted body',
      priority: 'normal',
      audience,
      requiresReadConfirmation: false,
    });
    const publishRequest = httpMock.expectOne('/api/announcements');

    facade.updateEditorDraft({
      ...facade.page().editorDraft!,
      title: 'Live title edited before publish failed',
      body: 'Live body edited before publish failed',
    });
    publishRequest.flush(
      { error: 'Announcement audience is not authorized.' },
      { status: 400, statusText: 'Bad Request' },
    );
    httpMock.expectOne('/api/announcements/audiences').flush([]);

    expect(facade.page().editorDraft).toMatchObject({
      title: 'Live title edited before publish failed',
      body: 'Live body edited before publish failed',
      audienceKey: '',
      availableAudiences: [],
    });
  });

  it('keeps temporary publish failures retryable without reloading audience options or exposing server detail', () => {
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
      title: 'Retryable title',
      body: 'Retryable body',
      priority: 'normal',
      audience,
      requiresReadConfirmation: false,
    });

    httpMock
      .expectOne('/api/announcements')
      .flush(
        { error: 'upstream service detail must stay private' },
        { status: 503, statusText: 'Service Unavailable' },
      );

    httpMock.expectNone('/api/announcements/audiences');
    expect(facade.page().pageCapabilities).toContain('createAnnouncement');
    expect(facade.page().editorDraft).toMatchObject({
      title: 'Retryable title',
      body: 'Retryable body',
      audienceKey: audience.key,
      availableAudiences: [audience],
    });
    expect(facade.page().editorError).toContain('could not be published right now');
    expect(facade.page().editorError).not.toContain('upstream service detail');
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
