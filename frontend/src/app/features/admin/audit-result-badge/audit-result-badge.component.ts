import { Component, Input } from '@angular/core';

import { AuditResultDisplay } from '../admin.types';

@Component({
  selector: 'app-audit-result-badge',
  standalone: true,
  template: `
    <span class="admin-badge" [class]="'admin-badge admin-badge--' + result" data-testid="audit-result-badge">
      <span class="admin-badge__icon" aria-hidden="true"></span>{{ label }}
    </span>
  `,
  styles: [
    `
      .admin-badge {
        display: inline-flex;
        min-width: 5.5rem;
        align-items: center;
        justify-content: center;
        gap: 0.3rem;
        border: 1px solid #cbd5e1;
        border-radius: 999px;
        padding: 0.125rem 0.5rem;
        font-size: 0.75rem;
        font-weight: 700;
      }

      .admin-badge__icon::before {
        content: '?';
      }

      .admin-badge__icon {
        inline-size: 1em;
        flex: 0 0 auto;
        text-align: center;
      }

      .admin-badge--success .admin-badge__icon::before {
        content: '✓';
      }

      .admin-badge--denied .admin-badge__icon::before {
        content: '⊘';
      }

      .admin-badge--failed .admin-badge__icon::before {
        content: '!';
      }

      .admin-badge--success {
        background: #ecfdf5;
        color: #047857;
      }

      .admin-badge--denied {
        background: #fff7ed;
        color: #c2410c;
      }

      .admin-badge--failed {
        background: #fef2f2;
        color: #b91c1c;
      }

      .admin-badge--unclassified {
        background: #f8fafc;
        color: #334155;
      }
    `
  ]
})
export class AuditResultBadgeComponent {
  @Input({ required: true }) result: AuditResultDisplay = 'success';
  @Input({ required: true }) label = 'Success';
}
