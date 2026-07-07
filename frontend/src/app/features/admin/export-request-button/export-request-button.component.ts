import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-export-request-button',
  standalone: true,
  template: `
    <button type="button" class="export-request" data-testid="export-request-disabled" disabled>
      Diagnostics request not available in MVP0
    </button>
  `,
  styles: [
    `
      .export-request {
        border: 1px solid #94a3b8;
        border-radius: 6px;
        background: #e2e8f0;
        color: #475569;
        cursor: not-allowed;
        font-weight: 700;
        padding: 0.55rem 0.8rem;
      }
    `
  ]
})
export class ExportRequestButtonComponent {
  @Input() canRequest = false;
  @Output() request = new EventEmitter<void>();
}
