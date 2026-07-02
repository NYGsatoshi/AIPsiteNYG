import { AfterViewChecked, Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild } from '@angular/core';

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
export class AuditDetailDrawerComponent implements AfterViewChecked {
  @Input() audit: AuditGridRow | null = null;
  @Input() returnFocusTo: HTMLElement | null = null;
  @Output() close = new EventEmitter<void>();
  @ViewChild('closeButton') closeButton?: ElementRef<HTMLButtonElement>;

  private focusedAuditId: string | null = null;

  ngAfterViewChecked(): void {
    if (!this.audit || this.focusedAuditId === this.audit.id) {
      return;
    }

    this.closeButton?.nativeElement.focus();
    this.focusedAuditId = this.audit.id;
  }

  @HostListener('keydown.escape', ['$event'])
  closeFromEscape(event: KeyboardEvent): void {
    if (!this.audit) {
      return;
    }

    event.preventDefault();
    this.close.emit();
  }
}
