import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  selector: 'app-request-id',
  standalone: true,
  template: `
    @if (displayId) {
      <p class="request-id">
        <span class="request-id__label">{{ requestId ? 'リクエストID' : 'ローカルエラーID' }}</span>
        <code>{{ displayId }}</code>
        @if (!requestId) {
          <span class="request-id__note">このIDはこの画面内の識別用です。</span>
        }
      </p>
    }
  `,
  styles: [
    `
      .request-id {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem 0.5rem;
        align-items: center;
        margin: 0;
        color: #475569;
        font-size: 0.875rem;
      }

      .request-id__label {
        font-weight: 700;
      }

      code {
        overflow-wrap: anywhere;
        border-radius: 4px;
        background: #f1f5f9;
        padding: 0.125rem 0.375rem;
        color: #334155;
      }

      .request-id__note {
        flex-basis: 100%;
        color: #64748b;
      }
    `
  ],
  changeDetection: ChangeDetectionStrategy.Eager
})
export class AppRequestIdComponent {
  @Input() requestId: string | null | undefined;
  @Input() localErrorId: string | null | undefined;

  get displayId(): string {
    return this.requestId?.trim() || this.localErrorId?.trim() || '';
  }
}
