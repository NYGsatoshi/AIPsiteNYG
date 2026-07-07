import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { NotificationItemComponent } from './notification-item/notification-item.component';
import { RightPanelComponent } from './right-panel/right-panel.component';
import { AIP_RIGHT_PANEL_MOCK, mapNotificationRoute, RightPanelFacade } from './right-panel.facade';
import {
  DEFAULT_RIGHT_PANEL_SCOPE,
  OTHER_RIGHT_PANEL_SCOPE,
  RIGHT_PANEL_MEMBERS,
  RIGHT_PANEL_NOTIFICATIONS,
} from './right-panel.mock';
import { RightPanelMember, RightPanelNotification } from './right-panel.types';

const storageKey = 'aipsite.rightPanel.mode';
const rightPanelMockState = {
  mode: 'expanded',
  selectedTab: 'members',
  activeScope: DEFAULT_RIGHT_PANEL_SCOPE,
  members: RIGHT_PANEL_MEMBERS,
  notifications: RIGHT_PANEL_NOTIFICATIONS,
};

describe('RightPanelComponent', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  async function createRightPanel(): Promise<
    ReturnType<typeof TestBed.createComponent<RightPanelComponent>>
  > {
    await TestBed.configureTestingModule({
      imports: [RightPanelComponent],
      providers: [provideRouter([]), { provide: AIP_RIGHT_PANEL_MOCK, useValue: rightPanelMockState }],
    }).compileComponents();

    const fixture = TestBed.createComponent(RightPanelComponent);
    fixture.componentRef.setInput('mode', 'expanded');
    fixture.componentRef.setInput('selectedTab', 'members');
    fixture.componentRef.setInput('activeScope', DEFAULT_RIGHT_PANEL_SCOPE);
    fixture.detectChanges();
    return fixture;
  }

  it('members list changes when active scope changes', async () => {
    const fixture = await createRightPanel();
    let text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('サンプル参加者A');

    fixture.componentInstance.facade.setActiveScope(OTHER_RIGHT_PANEL_SCOPE);
    fixture.detectChanges();

    text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('別スコープ参加者');
    expect(text).not.toContain('サンプル参加者A');
  });

  it('members from another scope are not rendered', async () => {
    const fixture = await createRightPanel();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('サンプル参加者A');
    expect(text).not.toContain('別スコープ参加者');
  });

  it('email is not rendered', async () => {
    const memberWithEmail = {
      ...RIGHT_PANEL_MEMBERS[0],
      email: 'member-a@example.test',
    } as RightPanelMember & { email: string };

    await TestBed.configureTestingModule({
      imports: [RightPanelComponent],
      providers: [
        provideRouter([]),
        {
          provide: AIP_RIGHT_PANEL_MOCK,
          useValue: {
            mode: 'expanded',
            selectedTab: 'members',
            activeScope: DEFAULT_RIGHT_PANEL_SCOPE,
            members: [memberWithEmail],
            notifications: RIGHT_PANEL_NOTIFICATIONS,
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(RightPanelComponent);
    fixture.componentRef.setInput('mode', 'expanded');
    fixture.componentRef.setInput('selectedTab', 'members');
    fixture.componentRef.setInput('activeScope', DEFAULT_RIGHT_PANEL_SCOPE);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('サンプル参加者A');
    expect(text).not.toContain('member-a@example.test');
    expect(text).not.toContain('@example.test');
  });

  it('unsupported notification targets are not clickable', async () => {
    await TestBed.configureTestingModule({
      imports: [NotificationItemComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(NotificationItemComponent);
    const unsupported = RIGHT_PANEL_NOTIFICATIONS.find(
      (notification) => notification.id === 'notification-unsupported',
    ) as RightPanelNotification;
    fixture.componentRef.setInput('notification', unsupported);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('a')).toBeNull();
    expect(element.querySelector('[data-testid="notification-target-unavailable"]')?.textContent).toContain('未対応');
  });

  it('notification body is not rendered as HTML', async () => {
    await TestBed.configureTestingModule({
      imports: [NotificationItemComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(NotificationItemComponent);
    const htmlBody = RIGHT_PANEL_NOTIFICATIONS.find(
      (notification) => notification.id === 'notification-html-body',
    ) as RightPanelNotification;
    fixture.componentRef.setInput('notification', htmlBody);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('strong')).toBeNull();
    expect(element.textContent).toContain('<strong>強調タグ</strong>');
  });

  it('panel collapsed state stored in sessionStorage', async () => {
    await TestBed.configureTestingModule({
      imports: [RightPanelComponent],
      providers: [provideRouter([]), { provide: AIP_RIGHT_PANEL_MOCK, useValue: rightPanelMockState }],
    }).compileComponents();

    const facade = TestBed.inject(RightPanelFacade);
    facade.setMode('expanded');
    expect(sessionStorage.getItem(storageKey)).toBe('expanded');

    facade.setMode('collapsed');
    expect(sessionStorage.getItem(storageKey)).toBe('collapsed');
  });

  it('session clear removes panel state', async () => {
    await TestBed.configureTestingModule({
      imports: [RightPanelComponent],
      providers: [provideRouter([]), { provide: AIP_RIGHT_PANEL_MOCK, useValue: rightPanelMockState }],
    }).compileComponents();

    const facade = TestBed.inject(RightPanelFacade);
    facade.setMode('expanded');
    facade.setSelectedTab('members');
    facade.clearPanelState();

    expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(facade.viewModel().mode).toBe('collapsed');
    expect(facade.viewModel().selectedTab).toBe('notifications');
  });

  it('mobile drawer does not expose hidden actions while collapsed', async () => {
    const fixture = await createRightPanel();
    fixture.componentRef.setInput('mode', 'collapsed');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[data-testid="right-panel-open"]')).toBeTruthy();
    expect(element.querySelector('a')).toBeNull();
    expect(element.querySelector('.notification__mark')).toBeNull();
    expect(element.textContent).not.toContain('対象を表示');
  });
});

describe('RightPanelFacade notifications', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('maps only known valid notification targets to Angular routes', () => {
    expect(mapNotificationRoute({ type: 'announcement', id: 'announcement-1' })).toBe(
      '/announcements/announcement-1',
    );
    expect(
      mapNotificationRoute(
        { type: 'channelConversation', id: 'conversation-1' },
        { workspaceId: 'workspace-1', projectId: '', conversationId: '' },
      ),
    ).toBe('/workspaces/workspace-1/channels/conversation-1');
    expect(mapNotificationRoute({ type: 'dmConversation', id: 'conversation-2' })).toBe(
      '/dm/conversation-2',
    );
    expect(
      mapNotificationRoute({ type: 'task', id: 'task-1', route: '/tasks/task-1' }),
    ).toBeUndefined();
    expect(mapNotificationRoute({ type: 'unsupported', id: 'legacy-1' })).toBeUndefined();
  });

  it('does not hide API notifications solely because local scope is empty', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    const facade = TestBed.inject(RightPanelFacade);
    const httpMock = TestBed.inject(HttpTestingController);
    httpMock.expectOne('/api/notifications').flush({
      items: [
        {
          id: 'notification-1',
          title: 'Announcement',
          body: 'Body',
          relatedEntityType: 'Announcement',
          relatedEntityId: 'announcement-1',
          isRead: false,
        },
      ],
    });

    facade.setActiveScope(DEFAULT_RIGHT_PANEL_SCOPE);

    expect(facade.viewModel().notifications.map((notification) => notification.id)).toEqual([
      'notification-1',
    ]);
    expect(facade.viewModel().unreadCount).toBe(1);
    httpMock.verify();
  });

  it('does not update unread count when mark-read fails', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    const facade = TestBed.inject(RightPanelFacade);
    const httpMock = TestBed.inject(HttpTestingController);
    httpMock.expectOne('/api/notifications').flush({
      items: [
        {
          id: 'notification-1',
          title: 'Announcement',
          relatedEntityType: 'Announcement',
          relatedEntityId: 'announcement-1',
          isRead: false,
        },
      ],
    });

    expect(facade.viewModel().unreadCount).toBe(1);

    facade.markNotificationRead('notification-1');
    httpMock
      .expectOne('/api/notifications/notification-1/read')
      .flush({ error: 'Failed' }, { status: 500, statusText: 'Server Error' });

    expect(facade.viewModel().unreadCount).toBe(1);
    httpMock.verify();
  });
});
