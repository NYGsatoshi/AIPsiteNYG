import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MessageComposerComponent } from './message-composer.component';

describe('MessageComposerComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  async function createComposer(draft = 'Hello'): Promise<ComponentFixture<MessageComposerComponent>> {
    await TestBed.configureTestingModule({
      imports: [MessageComposerComponent]
    }).compileComponents();

    const fixture = TestBed.createComponent(MessageComposerComponent);
    fixture.componentRef.setInput('draft', draft);
    fixture.detectChanges();
    return fixture;
  }

  it('renders Send as the primary action and keeps helper tools secondary', async () => {
    const fixture = await createComposer();
    const root = fixture.nativeElement as HTMLElement;
    const sendButton = root.querySelector<HTMLButtonElement>('[data-testid="send-message"]');

    expect(sendButton).not.toBeNull();
    expect(sendButton?.classList.contains('composer__send')).toBe(true);
    expect(sendButton?.getAttribute('type')).toBe('submit');
    expect(root.querySelector('[data-testid="composer-secondary-tools"]')).not.toBeNull();
    expect(root.textContent).toContain('Enterで送信');
    expect(root.textContent).toContain('Shift+Enterで改行');
  });

  it('sends on Enter and leaves Shift+Enter available for a newline', async () => {
    const fixture = await createComposer();
    const sendSpy = vi.spyOn(fixture.componentInstance.send, 'emit');

    const newlineEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      cancelable: true
    });
    fixture.componentInstance.onDraftKeydown(newlineEvent);

    expect(newlineEvent.defaultPrevented).toBe(false);
    expect(sendSpy).not.toHaveBeenCalled();

    const sendEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      cancelable: true
    });
    fixture.componentInstance.onDraftKeydown(sendEvent);

    expect(sendEvent.defaultPrevented).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('does not send Enter while IME composition is active', async () => {
    const fixture = await createComposer();
    const sendSpy = vi.spyOn(fixture.componentInstance.send, 'emit');

    fixture.componentInstance.onCompositionStart();
    fixture.componentInstance.onDraftKeydown(
      new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    );
    expect(sendSpy).not.toHaveBeenCalled();

    fixture.componentInstance.onCompositionEnd();
    fixture.componentInstance.onDraftKeydown(
      new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    );
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('shows sending state and prevents another submit while sending', async () => {
    const fixture = await createComposer();
    const sendSpy = vi.spyOn(fixture.componentInstance.send, 'emit');

    fixture.componentRef.setInput('sending', true);
    fixture.componentRef.setInput('sendState', { status: 'sending', clientRequestId: 'request-a' });
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const sendButton = root.querySelector<HTMLButtonElement>('[data-testid="send-message"]');

    expect(root.querySelector('[data-testid="composer-send-status"]')?.textContent).toContain(
      '送信しています'
    );
    expect(sendButton?.disabled).toBe(true);

    fixture.componentInstance.submit(new Event('submit', { cancelable: true }));
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('shows send failure beside the draft with retry guidance and keeps the draft', async () => {
    const fixture = await createComposer('Do not clear me');
    fixture.componentRef.setInput('sendState', {
      status: 'failed',
      message: 'Message API request failed.'
    });
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const error = root.querySelector('[data-testid="composer-send-error"]');
    const textarea = root.querySelector<HTMLTextAreaElement>('[data-testid="message-draft"]');

    expect(error?.textContent).toContain('Message API request failed.');
    expect(error?.textContent).toContain('再試行');
    expect(textarea?.value).toBe('Do not clear me');
  });
});
