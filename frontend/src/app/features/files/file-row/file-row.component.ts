import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import { FileScanStatusBadgeComponent } from '../file-scan-status-badge/file-scan-status-badge.component';
import { FileViewModel } from '../files.types';

@Component({
  selector: 'app-file-row',
  standalone: true,
  imports: [FileScanStatusBadgeComponent],
  templateUrl: './file-row.component.html',
  styleUrl: './file-row.component.scss'
})
export class FileRowComponent {
  readonly i18n = inject(I18nService);

  @Input({ required: true }) file!: FileViewModel;
  @Input() selected = false;
  @Output() readonly previewRequested = new EventEmitter<FileViewModel>();
  @Output() readonly downloadRequested = new EventEmitter<string>();
  @Output() readonly selectionChanged = new EventEmitter<{ file: FileViewModel; selected: boolean; range?: boolean }>();
  @Output() readonly adminOverrideRequested = new EventEmitter<{ fileId: string; reason: string }>();

  readonly auditReason = signal('');

  canDownload(): boolean {
    return (
      this.file.downloadState !== 'pending' &&
      this.file.scanStatus === 'allowed' &&
      this.file.downloadPolicy === 'available' &&
      this.file.capabilities.includes('download')
    );
  }

  downloadDisabledReason(): string | null {
    if (this.file.downloadState === 'pending') {
      return this.i18n.translate('files.row.downloadPending');
    }

    if (this.file.scanStatus === 'pending' || this.file.scanStatus === 'unavailable') {
      return this.i18n.translate('files.row.downloadScanPending');
    }

    if (this.file.scanStatus === 'blocked') {
      return this.i18n.translate('files.row.downloadBlocked');
    }

    if (this.file.downloadPolicy === 'denied' || !this.file.capabilities.includes('download')) {
      return this.i18n.translate('files.row.downloadDenied');
    }

    return null;
  }

  showAdminOverride(): boolean {
    return this.file.downloadPolicy === 'adminOverrideRequired';
  }

  canRequestAdminOverride(): boolean {
    return this.file.capabilities.includes('adminOverrideBlockedDownload') && this.auditReason().trim().length > 0;
  }

  requestPreview(): void {
    this.previewRequested.emit(this.file);
  }

  requestDownload(): void {
    if (this.canDownload() && this.file.canonicalFileId) {
      this.downloadRequested.emit(this.file.canonicalFileId);
    }
  }

  updateSelection(selected: boolean, event?: Event): void {
    this.selectionChanged.emit({
      file: this.file,
      selected,
      range: event instanceof MouseEvent && event.shiftKey,
    });
  }

  requestAdminOverride(): void {
    if (!this.canRequestAdminOverride()) {
      return;
    }

    this.adminOverrideRequested.emit({
      fileId: this.file.id,
      reason: this.auditReason().trim()
    });
  }

  updateAuditReason(value: string): void {
    this.auditReason.set(value);
  }

  formatBytes(bytes: number): string {
    return this.i18n.formatFileSize(bytes);
  }

  createdAtLabel(): string {
    return this.file.createdAt
      ? this.i18n.formatDateTime(this.file.createdAt, { dateStyle: 'medium', timeStyle: 'short' })
      : this.file.createdAtLabel;
  }
}
