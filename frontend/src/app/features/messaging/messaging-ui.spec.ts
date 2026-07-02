import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ChannelMessagingPageComponent } from './channel-messaging-page/channel-messaging-page.component';
import { DmPageComponent } from './dm-page/dm-page.component';
import { DraftStorageService } from './draft-storage.service';
import { AIP_MESSAGING_PAGE_MOCK, MessagingFacade } from './messaging.facade';
import {
  HIDDEN_CHANNEL_BODY,
  HIDDEN_DM_BODY,
  MESSAGING_PAGE_SCENARIOS,
  OTHER_USER_PRECISE_READ_TIMESTAMP
} from './messaging.mock';
import { MessagingPageViewModel } from './messaging.types';

const renderChannel = async (
  page: MessagingPageViewModel = MESSAGING_PAGE_SCENARIOS.channelDefault
): Promise<ComponentFixture<ChannelMessagingPageComponent>> => {
  await TestBed.configureTestingModule({
    imports: [ChannelMessagingPageComponent],
    providers: [provideRouter([]), { provide: AIP_MESSAGING_PAGE_MOCK, useValue: page }]
  }).compileComponents();

  const fixture = TestBed.createComponent(ChannelMessagingPageComponent);
  fixture.detectChanges();
  return fixture;
};

const renderDm = async (
  page: MessagingPageViewModel = MESSAGING_PAGE_SCENARIOS.dmDefault
): Promise<ComponentFixture<DmPageComponent>> => {
  await TestBed.configureTestingModule({
    imports: [DmPageComponent],
    providers: [provideRouter([]), { provide: AIP_MESSAGING_PAGE_MOCK, useValue: page }]
  }).compileComponents();

  const fixture = TestBed.createComponent(DmPageComponent);
  fixture.detectChanges();
  return fixture;
};

const textContent = (fixture: ComponentFixture<unknown>): string =>
  (fixture.nativeElement as HTMLElement).textContent ?? '';

describe('Messaging mock UI', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  it('hides message body for non-participant DM state', async () => {
    const fixture = await renderDm(MESSAGING_PAGE_SCENARIOS.nonParticipantDm);

    expect(textContent(fixture)).toContain('本文は表示できません');
    expect(textContent(fixture)).not.toContain(HIDDEN_DM_BODY);
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="message-composer"]')).toBeNull();
  });

  it('hides composer and body for removed participant state', async () => {
    const fixture = await renderChannel(MESSAGING_PAGE_SCENARIOS.removedParticipant);

    expect(textContent(fixture)).toContain('本文は表示できません');
    expect(textContent(fixture)).not.toContain(HIDDEN_CHANNEL_BODY);
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="message-composer"]')).toBeNull();
  });

  it('keeps draft through manual refresh', async () => {
    const fixture = await renderChannel();
    const facade = TestBed.inject(MessagingFacade);

    facade.setDraft('手動更新でも残る下書き');
    facade.manualRefresh();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const textarea = (fixture.nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>(
      '[data-testid="message-draft"]'
    );
    expect(textarea?.value).toBe('手動更新でも残る下書き');
  });

  it('clears draft on send success', async () => {
    const fixture = await renderChannel();
    const facade = TestBed.inject(MessagingFacade);

    facade.setDraft('送信成功で消える下書き');
    facade.sendDraft();
    fixture.detectChanges();

    expect(TestBed.inject(DraftStorageService).readDraft({
      tenantId: 'tenant-mock-a',
      workspaceId: 'workspace-mock-a',
      conversationId: 'channel-general'
    })).toBe('');
    expect((fixture.nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>('[data-testid="message-draft"]')?.value).toBe('');
  });

  it('clears draft on session boundary clear method', async () => {
    await renderChannel();
    const facade = TestBed.inject(MessagingFacade);
    const draftStorage = TestBed.inject(DraftStorageService);

    facade.setDraft('セッション境界で消える下書き');
    facade.clearDraftsForSessionBoundary();

    expect(draftStorage.readDraft({
      tenantId: 'tenant-mock-a',
      workspaceId: 'workspace-mock-a',
      conversationId: 'channel-general'
    })).toBe('');
    expect(facade.page().draft).toBe('');
  });

  it('keeps failed outgoing message visible with retry', async () => {
    const fixture = await renderChannel(MESSAGING_PAGE_SCENARIOS.failedOutgoingRetry);

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="failed-message"]')).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="retry-failed-message"]')).not.toBeNull();
  });

  it('renders failed local message distinctly from confirmed message', async () => {
    const fixture = await renderChannel(MESSAGING_PAGE_SCENARIOS.failedOutgoingRetry);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('[data-testid="failed-message"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="confirmed-message"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="safe-failure-reason"]')?.textContent).toContain('送信できませんでした');
  });

  it('does not render typing indicator or presence UI', async () => {
    const fixture = await renderChannel();
    const text = textContent(fixture).toLocaleLowerCase('ja-JP');

    expect(text).not.toContain('入力中');
    expect(text).not.toContain('typing');
    expect(text).not.toContain('オンライン');
    expect(text).not.toContain('presence');
  });

  it('does not render DM preview outside participant route', async () => {
    const fixture = await renderChannel();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="dm-preview-hidden"]')?.textContent).toContain(
      'DMプレビュー非表示'
    );
    expect(textContent(fixture)).not.toContain('DM本文は参加者だけに表示されます');
  });

  it('does not render other users precise read timestamps', async () => {
    const fixture = await renderChannel();

    expect(textContent(fixture)).not.toContain(OTHER_USER_PRECISE_READ_TIMESTAMP);
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="other-read-summary"]')).not.toBeNull();
  });

  it('mobile layout does not expose hidden actions', async () => {
    const fixture = await renderChannel(MESSAGING_PAGE_SCENARIOS.composerDisabled);
    (fixture.nativeElement as HTMLElement).style.width = '320px';
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="send-message"]')?.hasAttribute('disabled')).toBe(
      true
    );
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="retry-failed-message"]')).toBeNull();
  });
});
