import { Component, EventEmitter, Input, Output } from '@angular/core';

import { FileRowComponent } from '../file-row/file-row.component';
import { FileViewModel } from '../files.types';

@Component({
  selector: 'app-recent-files-list',
  standalone: true,
  imports: [FileRowComponent],
  templateUrl: './recent-files-list.component.html',
  styleUrl: './recent-files-list.component.scss'
})
export class RecentFilesListComponent {
  @Input({ required: true }) files: readonly FileViewModel[] = [];
  @Output() readonly downloadRequested = new EventEmitter<string>();
}
