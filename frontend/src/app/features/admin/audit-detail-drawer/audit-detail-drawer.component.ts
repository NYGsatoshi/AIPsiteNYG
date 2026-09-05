import { AfterViewChecked, ChangeDetectionStrategy, Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild } from '@angular/core';

import { AuditResultBadgeComponent } from '../audit-result-badge/audit-result-badge.component';
import { AuditSeverityBadgeComponent } from '../audit-severity-badge/audit-severity-badge.component';
import {
  AuditDetailStatus,
  AuditGridRow,
  AuditSensitiveMetadataViewModel,
} from '../admin.types';

@Component({
  selector: 'app-audit-detail-drawer',
  standalone: true,
  imports: [AuditResultBadgeComponent, AuditSeverityBadgeComponent],
  templateUrl: './audit-detail-drawer.component.html',
  styleUrl: './audit-detail-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager
})
export class AuditDetailDrawerComponent implements AfterViewChecked {
  @Input() isOpen = false;
  @Input() selectedAuditId: string | null = null;
  @Input() audit: AuditGridRow | null = null;
  @Input() status: AuditDetailStatus = 'idle';
  @Input() message?: string;
  @Input() canViewSensitiveMetadata = false;
  @Input() sensitiveMetadata: AuditSensitiveMetadataViewModel = {
    status: 'hidden',
    auditId: null,
    formattedJson: '',
    redactionApplied: false,
  };
  @Output() close = new EventEmitter<void>();
  @Output() sensitiveMetadataToggle = new EventEmitter<void>();
  @ViewChild('closeButton') closeButton?: ElementRef<HTMLButtonElement>;

  private focusedAuditId: string | null = null;

  get sensitiveMetadataExpanded(): boolean {
    return this.sensitiveMetadata.status !== 'hidden';
  }

  ngAfterViewChecked(): void {
    if (!this.isOpen) {
      this.focusedAuditId = null;
      return;
    }

    if (!this.selectedAuditId || this.focusedAuditId === this.selectedAuditId) {
      return;
    }

    this.closeButton?.nativeElement.focus();
    this.focusedAuditId = this.selectedAuditId;
  }

  @HostListener('keydown.escape', ['$event'])
  closeFromEscape(event: KeyboardEvent): void {
    if (!this.isOpen) {
      return;
    }

    event.preventDefault();
    this.close.emit();
  }
}
