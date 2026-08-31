import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { vi } from 'vitest';

import {
  ProtectedStateClearReason,
  RealtimeFacade,
} from '../../core/realtime/realtime.facade';
import { DurableRealtimeEvent } from '../../core/realtime/realtime.models';
import { AnnouncementsFacade } from './announcements.facade';

describe('AnnouncementsFacade', () => {
  let facade: AnnouncementsFacade;
  let httpMock: HttpTestingController;
  let realtimeEvents: Subject<DurableRealtimeEvent>;
  let clearProtectedState: ((reason: ProtectedStateClearReason) => void) | undefined;
  let catchUp: (() => void) | undefined;

  beforeEach(() => {
    realtimeEvents = new Subject<DurableRealtimeEvent>();
    clearProtectedState = undefined;
    catchUp = undefined;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: RealtimeFacade,
          useValue: {
            durableEvents$: realtimeEvents.asObservable(),
            registerProtectedStateClearer: (
              _owner: string,
              clearer: (reason: ProtectedStateClearReason) => void,
            ) => {
              clearProtectedState = clearer;
              return () => {
                clearProtectedState = undefined;
              };
            },
            registerCatchUp: (_owner: string, callback: () => void) => {
              catchUp = callback;
              return () => {
                catchUp = undefined;
              };
            },
          },
        },
      ],
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

  it('keeps mark-read single-flight and overlays a confirmed read across a delayed detail response', () => {
    const announcement = {
      id: 'announcement-read-1',
      title: 'Read confirmation',
      priority: 'Important',
      requiresReadConfirmation: true,
      isRead: false,
      publishedAt: '2026-08-25T00:00:00Z',
    };

    httpMock.expectOne('/api/announcements').flush({ items: [announcement] });
    httpMock.expectOne('/api/announcements/audiences').flush([]);
    const delayedDetail = httpMock.expectOne('/api/announcements/announcement-read-1');

    facade.markAnnouncementRead('announcement-read-1');
    const markReadRequest = httpMock.expectOne('/api/announcements/announcement-read-1/read');
    expect(markReadRequest.request.method).toBe('POST');
    expect(facade.page().announcements[0].readState).toMatchObject({
      isRead: false,
      isMarkingRead: true,
    });

    facade.markAnnouncementRead('announcement-read-1');
    httpMock.expectNone('/api/announcements/announcement-read-1/read');

    markReadRequest.flush({ status: 'OK' });
    delayedDetail.flush({ ...announcement, body: 'Delayed server detail', isRead: false });

    expect(facade.page().announcements[0].readState).toEqual({
      requiresReadConfirmation: true,
      isRead: true,
      isMarkingRead: false,
      markReadError: undefined,
    });
  });

  it('keeps an unread announcement retryable after a generic mark-read failure', () => {
    const announcement = {
      id: 'announcement-read-2',
      title: 'Retry confirmation',
      priority: 'Normal',
      requiresReadConfirmation: true,
      isRead: false,
      publishedAt: '2026-08-25T00:00:00Z',
    };

    httpMock.expectOne('/api/announcements').flush({ items: [announcement] });
    httpMock.expectOne('/api/announcements/audiences').flush([]);
    httpMock.expectOne('/api/announcements/announcement-read-2').flush({
      ...announcement,
      body: 'Read this',
    });

    facade.markAnnouncementRead('announcement-read-2');
    httpMock
      .expectOne('/api/announcements/announcement-read-2/read')
      .flush({ error: 'private backend reason' }, { status: 503, statusText: 'Unavailable' });

    expect(facade.page().announcements[0].readState).toMatchObject({
      isRead: false,
      isMarkingRead: false,
      markReadError: 'Could not mark this announcement as read. Try again.',
    });
    expect(facade.page().announcements[0].readState.markReadError).not.toContain('private backend reason');

    facade.markAnnouncementRead('announcement-read-2');
    const retry = httpMock.expectOne('/api/announcements/announcement-read-2/read');
    expect(facade.page().announcements[0].readState).toMatchObject({
      isRead: false,
      isMarkingRead: true,
      markReadError: undefined,
    });
    retry.flush({ status: 'OK' });
    expect(facade.page().announcements[0].readState.isRead).toBe(true);
  });

  it('revalidates an authorized direct detail omitted from a delayed list without a loading flash', () => {
    const directAnnouncement = {
      id: 'announcement-direct-detail',
      title: 'Authorized direct detail',
      body: 'Visible only through the direct detail route',
      priority: 'Important',
      requiresReadConfirmation: false,
      isRead: true,
      publishedAt: '2026-08-25T00:00:00Z',
    };
    const delayedList = httpMock.expectOne('/api/announcements');

    facade.selectAnnouncement(directAnnouncement.id);
    httpMock.expectOne(`/api/announcements/${directAnnouncement.id}`).flush(directAnnouncement);
    expect(facade.page().status).toBe('ready');

    delayedList.flush({ items: [] });
    httpMock.expectOne('/api/announcements/audiences').flush([]);

    expect(facade.page().selectedAnnouncementId).toBe(directAnnouncement.id);
    expect(facade.page().announcements).toHaveLength(1);
    expect(facade.page().announcements[0]).toMatchObject({
      id: directAnnouncement.id,
      body: directAnnouncement.body,
      detailState: 'loaded',
    });

    const revalidation = httpMock.expectOne(`/api/announcements/${directAnnouncement.id}`);
    expect(facade.page().announcements[0]).toMatchObject({
      id: directAnnouncement.id,
      body: directAnnouncement.body,
      detailState: 'loaded',
    });
    revalidation.flush(
      { error: 'Not found' },
      { status: 404, statusText: 'Not Found' },
    );

    expect(facade.page().announcements).toEqual([]);
  });

  it('clears every protected announcement request and rehydrates the same id only through catch-up', () => {
    const announcement = {
      id: 'announcement-protected-state',
      title: 'Prior tenant title',
      priority: 'Important',
      requiresReadConfirmation: true,
      isRead: false,
      publishedAt: '2026-08-25T00:00:00Z',
    };
    const audience = {
      key: 'workspace:11111111-1111-1111-1111-111111111111',
      scopeType: 'workspace',
      workspaceId: '11111111-1111-1111-1111-111111111111',
      groupId: null,
      channelId: null,
      displayName: 'Workspace',
      estimatedRecipientCount: 1,
    };

    httpMock.expectOne('/api/announcements').flush({ items: [announcement] });
    httpMock.expectOne('/api/announcements/audiences').flush([audience]);
    httpMock.expectOne(`/api/announcements/${announcement.id}`).flush({
      ...announcement,
      body: 'Prior tenant body',
    });
    expect(facade.page().announcements[0]).toMatchObject({
      title: announcement.title,
      body: 'Prior tenant body',
    });

    facade.markAnnouncementRead(announcement.id);
    const pendingRead = httpMock.expectOne(`/api/announcements/${announcement.id}/read`);
    facade.selectAnnouncement('announcement-prior-tenant-direct');
    const pendingDetail = httpMock.expectOne('/api/announcements/announcement-prior-tenant-direct');
    expect(facade.beginCreate()).toBe(true);
    const authorizedAudience = facade.page().editorDraft?.availableAudiences[0];
    facade.createAnnouncement({
      title: 'Prior tenant create',
      body: 'Must not survive a boundary',
      priority: 'normal',
      audience: authorizedAudience!,
      requiresReadConfirmation: true,
    });
    const pendingCreate = httpMock.expectOne(
      (request) => request.url === '/api/announcements' && request.method === 'POST',
    );
    facade.createAnnouncement({
      title: 'Reload audiences',
      body: 'Must not survive a boundary',
      priority: 'normal',
      audience: { ...authorizedAudience!, key: 'workspace:revoked' },
      requiresReadConfirmation: false,
    });
    const pendingAudience = httpMock.expectOne('/api/announcements/audiences');
    catchUp?.();
    const pendingList = httpMock.expectOne('/api/announcements');
    clearProtectedState?.('tenant');

    expect(
      [pendingRead, pendingDetail, pendingCreate, pendingAudience, pendingList].every(
        (request) => request.cancelled,
      ),
    ).toBe(true);
    expect(facade.page()).toMatchObject({
      status: 'loading',
      announcements: [],
      selectedAnnouncementId: null,
      pageCapabilities: [],
    });

    catchUp?.();
    httpMock.expectOne('/api/announcements').flush({
      items: [{ ...announcement, title: 'Current tenant title' }],
    });
    httpMock.expectOne('/api/announcements/audiences').flush([]);
    httpMock.expectOne(`/api/announcements/${announcement.id}`).flush({
      ...announcement,
      title: 'Current tenant title',
      body: 'Current tenant body',
    });
    expect(facade.page().announcements[0]).toMatchObject({
      id: announcement.id,
      title: 'Current tenant title',
      body: 'Current tenant body',
    });
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

  it('queues an immediate reviewed delivery through the durable draft endpoints without inventing a published announcement', async () => {
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
    const audience = facade.page().editorDraft!.availableAudiences[0]!;

    facade.createAnnouncement({
      title: 'Immediate durable delivery',
      body: 'The worker, not the browser, must create the announcement.',
      priority: 'important',
      audience,
      requiresReadConfirmation: true,
      deliveryMode: 'now',
      createIdempotencyKey: 'announcement-draft-create-test-0001',
      transitionIdempotencyKey: 'announcement-draft-transition-test-0001',
    });

    const create = httpMock.expectOne('/api/announcement-drafts');
    expect(create.request.method).toBe('POST');
    expect(create.request.headers.get('Idempotency-Key')).toBe('announcement-draft-create-test-0001');
    expect(create.request.body).toEqual({
      content: {
        target: { workspaceId, groupId: null, channelId: null },
        title: 'Immediate durable delivery',
        body: 'The worker, not the browser, must create the announcement.',
        priority: 1,
        isPinned: false,
        requiresReadConfirmation: true,
        expiresAt: null,
      },
    });
    create.flush({
      id: '11111111-1111-1111-1111-111111111119',
      version: 1,
      status: 'Draft',
      workspaceId,
      groupId: null,
      channelId: null,
      title: 'Immediate durable delivery',
      body: 'The worker, not the browser, must create the announcement.',
      priority: 'Important',
      isPinned: false,
      requiresReadConfirmation: true,
    });

    await nextAsyncCommandTurn();
    const transition = httpMock.expectOne('/api/announcement-drafts/11111111-1111-1111-1111-111111111119/publish');
    expect(transition.request.method).toBe('POST');
    expect(transition.request.headers.get('Idempotency-Key')).toBe('announcement-draft-transition-test-0001');
    expect(transition.request.body).toEqual({ expectedVersion: 1 });
    transition.flush({
      id: '11111111-1111-1111-1111-111111111119',
      version: 2,
      status: 'Scheduled',
      workspaceId,
      groupId: null,
      channelId: null,
      title: 'Immediate durable delivery',
      body: 'The worker, not the browser, must create the announcement.',
      priority: 'Important',
      isPinned: false,
      requiresReadConfirmation: true,
      scheduledForUtc: '2026-08-30T00:00:00Z',
      scheduleTimeZoneId: 'UTC',
      scheduleLocalDateTime: '2026-08-30T00:00:00',
    });

    await nextAsyncCommandTurn();
    expect(facade.page().announcements).toEqual([]);
    expect(facade.page().editorDraft).toMatchObject({
      id: '11111111-1111-1111-1111-111111111119',
      version: 2,
      publicationState: 'scheduled',
      scheduledAtLabel: '2026-08-30T00:00 (UTC)',
    });
    expect(facade.page().message).toContain('Publication queued');
    expect(facade.page().isPublishing).toBe(false);
    httpMock.expectNone('/api/announcements');
  });

  it('replays a lost immediate-delivery transition without creating or editing another draft', async () => {
    const workspaceId = '11111111-1111-1111-1111-111111111111';
    const draftId = '11111111-1111-1111-1111-111111111120';
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
    const audience = facade.page().editorDraft!.availableAudiences[0]!;
    const submission = {
      title: 'Retryable durable delivery',
      body: 'The same transition key must survive a lost response.',
      priority: 'normal' as const,
      audience,
      requiresReadConfirmation: false,
      deliveryMode: 'now' as const,
      createIdempotencyKey: 'announcement-draft-create-test-0002',
      transitionIdempotencyKey: 'announcement-draft-transition-test-0002',
    };

    facade.createAnnouncement(submission);
    httpMock.expectOne('/api/announcement-drafts').flush({
      id: draftId,
      version: 1,
      status: 'Draft',
      workspaceId,
      groupId: null,
      channelId: null,
      title: submission.title,
      body: submission.body,
      priority: 'Normal',
      isPinned: false,
      requiresReadConfirmation: false,
    });

    await nextAsyncCommandTurn();
    const firstTransition = httpMock.expectOne(`/api/announcement-drafts/${draftId}/publish`);
    expect(firstTransition.request.headers.get('Idempotency-Key')).toBe(submission.transitionIdempotencyKey);
    firstTransition.flush(
      { error: 'The server could not confirm the transition.' },
      { status: 503, statusText: 'Service Unavailable' },
    );

    await nextAsyncCommandTurn();
    expect(facade.page().editorDraft).toMatchObject({
      id: draftId,
      version: 1,
      transitionIdempotencyKey: submission.transitionIdempotencyKey,
      publicationState: 'draft',
    });

    const retryDraft = facade.page().editorDraft!;
    facade.createAnnouncement({
      ...submission,
      draftId: retryDraft.id,
      draftVersion: retryDraft.version,
      createIdempotencyKey: retryDraft.createIdempotencyKey,
      transitionIdempotencyKey: retryDraft.transitionIdempotencyKey,
    });

    const replay = httpMock.expectOne(`/api/announcement-drafts/${draftId}/publish`);
    expect(replay.request.headers.get('Idempotency-Key')).toBe(submission.transitionIdempotencyKey);
    httpMock.expectNone(`/api/announcement-drafts/${draftId}`);
    httpMock.expectNone('/api/announcement-drafts');
    replay.flush({
      id: draftId,
      version: 2,
      status: 'Scheduled',
      workspaceId,
      groupId: null,
      channelId: null,
      title: submission.title,
      body: submission.body,
      priority: 'Normal',
      isPinned: false,
      requiresReadConfirmation: false,
      scheduledForUtc: '2026-08-30T00:00:00Z',
      scheduleTimeZoneId: 'UTC',
      scheduleLocalDateTime: '2026-08-30T00:00:00',
    });

    await nextAsyncCommandTurn();
    expect(facade.page().editorDraft).toMatchObject({
      id: draftId,
      version: 2,
      publicationState: 'scheduled',
    });
    expect(facade.page().message).toContain('Publication queued');
  });

  it('keeps immediate publication single-flight while the authoritative response is pending', () => {
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
    const audience = facade.page().editorDraft!.availableAudiences[0]!;
    const submission = {
      title: 'One authoritative publication',
      body: 'The browser must not post this twice.',
      priority: 'normal' as const,
      audience,
      requiresReadConfirmation: false,
    };

    facade.createAnnouncement(submission);
    facade.createAnnouncement(submission);

    const requests = httpMock.match((request) =>
      request.url === '/api/announcements' && request.method === 'POST',
    );
    expect(requests).toHaveLength(1);
    expect(facade.page().isPublishing).toBe(true);
    requests[0]!.flush({
      id: 'announcement-created-once',
      workspaceId,
      groupId: null,
      channelId: null,
      title: submission.title,
      body: submission.body,
      priority: 0,
      requiresReadConfirmation: false,
      isRead: false,
      publishedAt: '2026-08-26T12:00:00Z',
    });
    expect(facade.page().isPublishing).toBe(false);
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

  it('does not let a deferred announcement refresh discard a newly opened editor', () => {
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

    vi.useFakeTimers();
    try {
      // The durable event queues a refresh while no editor is active. A user
      // can legitimately open the editor before that short debounce fires.
      realtimeEvents.next({
        eventId: 'announcement-changed-1',
        eventType: 'Announcements.AnnouncementChanged.v1',
        payloadSchemaVersion: 1,
        occurredAt: '2026-08-27T00:00:00Z',
        tenantId: 'tenant-1',
        aggregateType: 'Announcement',
        aggregateId: 'announcement-1',
        aggregateVersion: 1,
        actor: { actorType: 'System', actorId: null },
        correlationId: null,
        causationId: null,
        payload: {},
      });

      expect(facade.beginCreate()).toBe(true);
      facade.updateEditorDraft({
        ...facade.page().editorDraft!,
        title: 'Preserved title',
        body: 'Preserved body',
      });

      vi.advanceTimersByTime(100);
      httpMock.expectNone('/api/announcements');
    } finally {
      vi.useRealTimers();
    }

    expect(facade.page().editorDraft).toMatchObject({
      title: 'Preserved title',
      body: 'Preserved body',
      availableAudiences: [
        expect.objectContaining({ key: audienceDto.key }),
      ],
    });
    expect(facade.page().message).toContain('Your draft was preserved');
  });

  it('retains an active editor when an earlier refresh response arrives after it opens', () => {
    const workspaceId = '22222222-2222-2222-2222-222222222222';
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

    vi.useFakeTimers();
    try {
      realtimeEvents.next({
        eventId: 'announcement-changed-2',
        eventType: 'Announcements.AnnouncementChanged.v1',
        payloadSchemaVersion: 1,
        occurredAt: '2026-08-27T00:00:00Z',
        tenantId: 'tenant-1',
        aggregateType: 'Announcement',
        aggregateId: 'announcement-2',
        aggregateVersion: 1,
        actor: { actorType: 'System', actorId: null },
        correlationId: null,
        causationId: null,
        payload: {},
      });
      vi.advanceTimersByTime(100);
      const delayedRefresh = httpMock.expectOne('/api/announcements');

      expect(facade.beginCreate()).toBe(true);
      facade.updateEditorDraft({
        ...facade.page().editorDraft!,
        title: 'Preserved while refresh completes',
        body: 'The response started before the user opened the editor.',
      });

      delayedRefresh.flush({ items: [] });
      httpMock.expectOne('/api/announcements/audiences').flush([audienceDto]);
    } finally {
      vi.useRealTimers();
    }

    expect(facade.page().editorDraft).toMatchObject({
      title: 'Preserved while refresh completes',
      body: 'The response started before the user opened the editor.',
      availableAudiences: [
        expect.objectContaining({ key: audienceDto.key }),
      ],
    });
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

const nextAsyncCommandTurn = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve));
