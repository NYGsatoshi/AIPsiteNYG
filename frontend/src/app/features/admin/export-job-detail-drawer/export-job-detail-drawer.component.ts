import { AfterViewChecked, Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild } from '@angular/core';

import { ExportJobGridRow } from '../admin.types';

@Component({
  selector: 'app-export-job-detail-drawer',
  standalone: true,
  templateUrl: './export-job-detail-drawer.component.html',
  styleUrl: './export-job-detail-drawer.component.scss'
})
export class ExportJobDetailDrawerComponent implements AfterViewChecked {
  @Input() job: ExportJobGridRow | null = null;
  @Input() returnFocusTo: HTMLElement | null = null;
  @Output() close = new EventEmitter<void>();
  @ViewChild('closeButton') closeButton?: ElementRef<HTMLButtonElement>;

  private focusedJobId: string | null = null;

  ngAfterViewChecked(): void {
    if (!this.job || this.focusedJobId === this.job.id) {
      return;
    }

    this.closeButton?.nativeElement.focus();
    this.focusedJobId = this.job.id;
  }

  @HostListener('keydown.escape', ['$event'])
  closeFromEscape(event: KeyboardEvent): void {
    if (!this.job) {
      return;
    }

    event.preventDefault();
    this.close.emit();
  }
}
