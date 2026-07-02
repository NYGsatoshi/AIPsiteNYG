import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-export-request-button',
  standalone: true,
  template: `
    @if (canRequest) {
      <button type="button" class="export-request" data-testid="export-request-action" (click)="request.emit()">
        Request diagnostics
      </button>
    } @else {
      <p class="export-request__denied" data-testid="export-request-not-allowed">
        Diagnostics request is hidden without explicit mock capability. UI state is not authorization.
      </p>
    }
  `,
  styles: [
    `
      .export-request {
        border: 1px solid #1d4ed8;
        border-radius: 6px;
        background: #1d4ed8;
        color: #ffffff;
        cursor: pointer;
        font-weight: 700;
        padding: 0.55rem 0.8rem;
      }

      .export-request__denied {
        margin: 0;
        color: #475569;
        font-size: 0.875rem;
      }
    `
  ]
})
export class ExportRequestButtonComponent {
  @Input() canRequest = false;
  @Output() request = new EventEmitter<void>();
}
