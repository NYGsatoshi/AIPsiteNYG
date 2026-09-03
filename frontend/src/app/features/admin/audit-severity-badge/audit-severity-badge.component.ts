import { Component, Input } from '@angular/core';

import { AuditSeverityDisplay } from '../admin.types';

@Component({
  selector: 'app-audit-severity-badge',
  standalone: true,
  template: `
    <span class="admin-badge" [class]="'admin-badge admin-badge--' + severity" data-testid="audit-severity-badge">
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

      .admin-badge--info .admin-badge__icon::before {
        content: '●';
      }

      .admin-badge--warning .admin-badge__icon::before {
        content: '▲';
      }

      .admin-badge--critical .admin-badge__icon::before {
        content: '◆';
      }

      .admin-badge--info {
        background: #eff6ff;
        color: #1d4ed8;
      }

      .admin-badge--warning {
        background: #fffbeb;
        color: #a16207;
      }

      .admin-badge--critical {
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
export class AuditSeverityBadgeComponent {
  @Input({ required: true }) severity: AuditSeverityDisplay = 'info';
  @Input({ required: true }) label = 'Info';
}
