import { TestBed } from '@angular/core/testing';

import { NotificationItemComponent } from './notification-item/notification-item.component';
import { RightPanelComponent } from './right-panel/right-panel.component';
import { AIP_RIGHT_PANEL_MOCK, RightPanelFacade } from './right-panel.facade';
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
      providers: [{ provide: AIP_RIGHT_PANEL_MOCK, useValue: rightPanelMockState }],
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

  it('notification targets and mark-read actions are non-clickable in MVP0', async () => {
    await TestBed.configureTestingModule({
      imports: [NotificationItemComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(NotificationItemComponent);
    const unsupported = RIGHT_PANEL_NOTIFICATIONS.find(
      (notification) => notification.id === 'notification-unsupported',
    ) as RightPanelNotification;
    fixture.componentRef.setInput('notification', unsupported);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('a')).toBeNull();
    expect(element.querySelector('button')).toBeNull();
    expect(element.querySelector('[data-testid="notification-target-unavailable"]')?.textContent).toContain('MVP0');
  });

  it('notification body is not rendered as HTML', async () => {
    await TestBed.configureTestingModule({
      imports: [NotificationItemComponent],
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
      providers: [{ provide: AIP_RIGHT_PANEL_MOCK, useValue: rightPanelMockState }],
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
      providers: [{ provide: AIP_RIGHT_PANEL_MOCK, useValue: rightPanelMockState }],
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
