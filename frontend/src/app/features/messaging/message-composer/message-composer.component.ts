import { Component, EventEmitter, Input, Output } from '@angular/core';

import { MessageSendState } from '../messaging.types';

@Component({
  selector: 'app-message-composer',
  standalone: true,
  template: `
    <form class="composer" data-testid="message-composer" (submit)="submit($event)">
      <label for="message-draft">
        <span>メッセージ</span>
        <textarea
          id="message-draft"
          rows="3"
          data-testid="message-draft"
          [disabled]="disabled || sending"
          [value]="draft"
          (input)="onDraftInput($event)"
          (keydown)="onDraftKeydown($event)"
          (compositionstart)="onCompositionStart()"
          (compositionend)="onCompositionEnd()"
          aria-describedby="composer-keyboard-hint"
          placeholder="本文を入力"
        ></textarea>
      </label>

      <p id="composer-keyboard-hint" class="composer__hint">
        Enterで送信 · Shift+Enterで改行 · IME変換中は送信されません
      </p>

      @if (sending || sendState.status === 'sending') {
        <p class="composer__status" data-testid="composer-send-status" role="status" aria-live="polite">
          送信しています…
        </p>
      } @else if (sendState.status === 'failed') {
        <div class="composer__error" data-testid="composer-send-error" role="alert">
          <strong>送信できませんでした。</strong>
          <span>{{ sendState.message }}</span>
          <span>入力内容は保持されています。失敗したメッセージの「再試行」を選択してください。</span>
        </div>
      }

      <div class="composer__footer">
        <div class="composer__secondary-tools" data-testid="composer-secondary-tools" aria-label="補助ツール">
          <span class="composer__secondary-label">補助ツール</span>
          <p class="composer__attachment" data-testid="attachment-disabled">{{ attachmentDisabledLabel }}</p>
        </div>

        @if (disabledReason) {
          <p class="composer__disabled" data-testid="composer-disabled-reason">{{ disabledReason }}</p>
        }

        <button
          class="composer__send"
          type="submit"
          data-testid="send-message"
          [attr.aria-busy]="sending"
          [disabled]="disabled || sending || draft.trim().length === 0"
        >
          {{ sending ? '送信中…' : '送信' }}
        </button>
      </div>
    </form>
  `,
  styleUrl: './message-composer.component.scss'
})
export class MessageComposerComponent {
  @Input() draft = '';
  @Input() disabled = false;
  @Input() sending = false;
  @Input() sendState: MessageSendState = { status: 'idle' };
  @Input() disabledReason = '';
  @Input() attachmentDisabledLabel = '添付はまだ利用できません';
  @Output() readonly draftChange = new EventEmitter<string>();
  @Output() readonly send = new EventEmitter<void>();

  private composing = false;

  onDraftInput(event: Event): void {
    this.draftChange.emit((event.target as HTMLTextAreaElement | null)?.value ?? '');
  }

  onCompositionStart(): void {
    this.composing = true;
  }

  onCompositionEnd(): void {
    this.composing = false;
  }

  onDraftKeydown(event: KeyboardEvent): void {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.isComposing ||
      this.composing
    ) {
      return;
    }

    const value = (event.target as HTMLTextAreaElement | null)?.value ?? this.draft;
    if (!this.canSend(value)) {
      return;
    }

    event.preventDefault();
    this.send.emit();
  }

  submit(event: Event): void {
    event.preventDefault();
    if (this.canSend(this.draft)) {
      this.send.emit();
    }
  }

  private canSend(value: string): boolean {
    return !this.disabled && !this.sending && value.trim().length > 0;
  }
}
