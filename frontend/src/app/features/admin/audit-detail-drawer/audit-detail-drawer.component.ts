import { Component, EventEmitter, Input, Output } from '@angular/core';

import { AuditResultBadgeComponent } from '../audit-result-badge/audit-result-badge.component';
import { AuditSeverityBadgeComponent } from '../audit-severity-badge/audit-severity-badge.component';
import { AuditGridRow } from '../admin.types';

@Component({
  selector: 'app-audit-detail-drawer',
  standalone: true,
  imports: [AuditResultBadgeComponent, AuditSeverityBadgeComponent],
  templateUrl: './audit-detail-drawer.component.html',
  styleUrl: './audit-detail-drawer.component.scss'
})
export class AuditDetailDrawerComponent {
  @Input() audit: AuditGridRow | null = null;
  @Output() close = new EventEmitter<void>();
}
