import { Component, EventEmitter, Input, Output } from '@angular/core';

import { ExportJobGridRow } from '../admin.types';

@Component({
  selector: 'app-export-job-detail-drawer',
  standalone: true,
  templateUrl: './export-job-detail-drawer.component.html',
  styleUrl: './export-job-detail-drawer.component.scss'
})
export class ExportJobDetailDrawerComponent {
  @Input() job: ExportJobGridRow | null = null;
  @Output() close = new EventEmitter<void>();
}
