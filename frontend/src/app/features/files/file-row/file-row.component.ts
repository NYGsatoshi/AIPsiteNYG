import { Component, EventEmitter, Input, Output, signal } from '@angular/core';

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
  @Input({ required: true }) file!: FileViewModel;
  @Input() selected = false;
  @Output() readonly downloadRequested = new EventEmitter<string>();
  @Output() readonly selectionChanged = new EventEmitter<{ file: FileViewModel; selected: boolean }>();
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
      return 'Download authorization is pending.';
    }

    if (this.file.scanStatus === 'pending' || this.file.scanStatus === 'unavailable') {
      return 'Download is disabled until scan state allows it.';
    }

    if (this.file.scanStatus === 'blocked') {
      return 'Download is blocked by file scan state.';
    }

    if (this.file.downloadPolicy === 'denied' || !this.file.capabilities.includes('download')) {
      return 'You do not have permission to download this file.';
    }

    return null;
  }

  showAdminOverride(): boolean {
    return this.file.downloadPolicy === 'adminOverrideRequired';
  }

  canRequestAdminOverride(): boolean {
    return this.file.capabilities.includes('adminOverrideBlockedDownload') && this.auditReason().trim().length > 0;
  }

  requestDownload(): void {
    if (this.canDownload() && this.file.canonicalFileId) {
      this.downloadRequested.emit(this.file.canonicalFileId);
    }
  }

  updateSelection(selected: boolean): void {
    this.selectionChanged.emit({ file: this.file, selected });
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
    if (bytes >= 1024 * 1024) {
      return `${Math.round(bytes / 1024 / 1024)} MB`;
    }

    return `${Math.round(bytes / 1024)} KB`;
  }
}
