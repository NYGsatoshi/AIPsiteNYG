import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-message-composer',
  standalone: true,
  template: `
    <form class="composer" data-testid="message-composer" (submit)="submit($event)">
      <label>
        <span>メッセージ</span>
        <textarea
          rows="3"
          data-testid="message-draft"
          [disabled]="disabled || sending"
          [value]="draft"
          (input)="onDraftInput($event)"
          placeholder="本文を入力"
        ></textarea>
      </label>
      <div class="composer__footer">
        <p class="composer__attachment" data-testid="attachment-disabled">{{ attachmentDisabledLabel }}</p>
        @if (disabledReason) {
          <p class="composer__disabled" data-testid="composer-disabled-reason">{{ disabledReason }}</p>
        }
        <button type="submit" data-testid="send-message" [disabled]="disabled || sending || draft.trim().length === 0">
          {{ sending ? '送信中' : '送信' }}
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
  @Input() disabledReason = '';
  @Input() attachmentDisabledLabel = '添付はまだ利用できません';
  @Output() readonly draftChange = new EventEmitter<string>();
  @Output() readonly send = new EventEmitter<void>();

  onDraftInput(event: Event): void {
    this.draftChange.emit((event.target as HTMLTextAreaElement | null)?.value ?? '');
  }

  submit(event: Event): void {
    event.preventDefault();
    if (!this.disabled && !this.sending && this.draft.trim().length > 0) {
      this.send.emit();
    }
  }
}
