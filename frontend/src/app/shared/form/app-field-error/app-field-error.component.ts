import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-field-error',
  standalone: true,
  template: `
    @if (messages.length > 0) {
      <ul class="field-error" [id]="id" role="alert">
        @for (message of messages; track message) {
          <li>{{ message }}</li>
        }
      </ul>
    }
  `,
  styles: [
    `
      .field-error {
        display: grid;
        gap: 0.25rem;
        margin: 0.35rem 0 0;
        padding: 0;
        list-style: none;
        color: #b91c1c;
        font-size: 0.875rem;
      }
    `
  ]
})
export class AppFieldErrorComponent {
  @Input() id: string | null = null;
  @Input() messages: readonly string[] = [];
}
