import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ConversationListComponent } from './conversation-list/conversation-list.component';
import { ConversationSettingsPanelComponent } from './conversation-settings-panel/conversation-settings-panel.component';
import { MessageGlobalSettingsService } from './message-global-settings.service';
import { MessageSettingsPageComponent } from './message-settings-page/message-settings-page.component';

describe('Message settings scope separation', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController, null)?.verify();
    globalThis.localStorage?.clear();
    TestBed.resetTestingModule();
  });

  it('updates mute only through the currently opened conversation state endpoint', async () => {
    await TestBed.configureTestingModule({
      imports: [ConversationSettingsPanelComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();

    const httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ConversationSettingsPanelComponent);
    fixture.componentRef.setInput('conversationId', 'conversation-a');
    fixture.componentRef.setInput('conversationTitle', 'General');
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLButtonElement>('[data-testid="conversation-settings-trigger"]')?.click();

    const stateRequest = httpMock.expectOne('/api/conversations/conversation-a/state');
    expect(stateRequest.request.method).toBe('GET');
    expect(stateRequest.request.withCredentials).toBe(true);
    stateRequest.flush({ conversationId: 'conversation-a', isMuted: false });
    fixture.detectChanges();

    const select = root.querySelector<HTMLSelectElement>('[data-testid="conversation-notification-level"]');
    expect(select?.value).toBe('all');
    select!.value = 'muted';
    select!.dispatchEvent(new Event('change'));

    const saveRequest = httpMock.expectOne('/api/conversations/conversation-a/state');
    expect(saveRequest.request.method).toBe('PATCH');
    expect(saveRequest.request.body).toEqual({ isMuted: true });
    expect(saveRequest.request.withCredentials).toBe(true);
    saveRequest.flush({ conversationId: 'conversation-a', isMuted: true });
    fixture.detectChanges();

    expect(root.querySelector('[data-testid="conversation-settings-panel"]')?.textContent).toContain(
      'this conversation only'
    );
    expect(root.textContent).toContain('Muted');
  });

  it('rejects a participant-state response for a different conversation', async () => {
    await TestBed.configureTestingModule({
      imports: [ConversationSettingsPanelComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();

    const httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ConversationSettingsPanelComponent);
    fixture.componentRef.setInput('conversationId', 'conversation-a');
    fixture.componentRef.setInput('conversationTitle', 'General');
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="conversation-settings-trigger"]')
      ?.click();
    httpMock.expectOne('/api/conversations/conversation-a/state').flush({
      conversationId: 'conversation-b',
      isMuted: true
    });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('response was incomplete');
    expect(fixture.componentInstance.isMuted()).toBe(false);
  });

  it('requires confirmation before applying a global Message change', async () => {
    globalThis.localStorage?.clear();
    await TestBed.configureTestingModule({
      imports: [MessageSettingsPageComponent],
      providers: [provideRouter([])]
    }).compileComponents();

    const fixture = TestBed.createComponent(MessageSettingsPageComponent);
    const settings = TestBed.inject(MessageGlobalSettingsService);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    const checkbox = root.querySelector<HTMLInputElement>('[data-testid="global-show-unread-badges"]');
    expect(settings.showUnreadBadges()).toBe(true);
    checkbox!.checked = false;
    checkbox!.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    root.querySelector<HTMLButtonElement>('[data-testid="save-global-message-settings"]')?.click();
    fixture.detectChanges();
    expect(settings.showUnreadBadges()).toBe(true);
    expect(root.querySelector('[data-testid="global-settings-confirmation"]')).not.toBeNull();
    expect(root.textContent).toContain('Individual conversation mute settings will not be changed');

    root.querySelector<HTMLButtonElement>('[data-testid="confirm-global-message-settings"]')?.click();
    fixture.detectChanges();
    expect(settings.showUnreadBadges()).toBe(false);
    expect(root.textContent).toContain('Global message display settings were updated');
  });

  it('applies the global unread-badge preference without changing conversation data', async () => {
    await TestBed.configureTestingModule({ imports: [ConversationListComponent] }).compileComponents();

    const fixture = TestBed.createComponent(ConversationListComponent);
    fixture.componentRef.setInput('conversations', [
      {
        id: 'conversation-a',
        kind: 'channel',
        title: 'General',
        route: '/conversations/conversation-a',
        lastActivityLabel: 'Now',
        safePreviewLabel: 'Preview',
        viewerIsParticipant: true,
        unreadCount: 4
      }
    ]);
    fixture.componentRef.setInput('showUnreadBadges', false);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="conversation-unread-badge"]')).toBeNull();
  });
});
