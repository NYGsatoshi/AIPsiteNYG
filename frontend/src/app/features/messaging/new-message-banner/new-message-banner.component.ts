import { Component, EventEmitter, Output, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-new-message-banner',
  standalone: true,
  template: `
    <button
      type="button"
      class="new-message-banner"
      data-testid="new-message-banner"
      (click)="acknowledge.emit()"
    >
      新着メッセージがあります
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      :host {
        display: block;
      }

      .new-message-banner {
        width: 100%;
        min-height: 38px;
        border: 1px solid #2f6f6d;
        border-radius: 6px;
        background: #edfafa;
        color: #164e4b;
        font: inherit;
        font-weight: 900;
        cursor: pointer;
      }
    `,
  ],
})
export class NewMessageBannerComponent {
  @Output() readonly acknowledge = new EventEmitter<void>();
}
