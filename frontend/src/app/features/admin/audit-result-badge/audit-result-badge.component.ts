import { Component, Input } from '@angular/core';

import { AuditResultDisplay } from '../admin.types';

@Component({
  selector: 'app-audit-result-badge',
  standalone: true,
  template: `
    <span [class]="'admin-badge admin-badge--' + result" data-testid="audit-result-badge">
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
