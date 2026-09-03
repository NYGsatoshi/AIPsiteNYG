import { Component, Input } from '@angular/core';

import { AuditSeverityDisplay } from '../admin.types';

@Component({
  selector: 'app-audit-severity-badge',
  standalone: true,
  template: `
    <span [class]="'admin-badge admin-badge--' + severity" data-testid="audit-severity-badge">
      {{ label }}
    </span>
  `,
  styles: [
    `
      .admin-badge {
        display: inline-flex;
        min-width: 5.5rem;
        justify-content: center;
        border: 1px solid #cbd5e1;
        border-radius: 999px;
        padding: 0.125rem 0.5rem;
        font-size: 0.75rem;
        font-weight: 700;
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
