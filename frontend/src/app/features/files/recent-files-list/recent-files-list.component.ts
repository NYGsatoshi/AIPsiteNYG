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
  @Input() selectedFileIds: ReadonlySet<string> = new Set();
  @Output() readonly previewRequested = new EventEmitter<FileViewModel>();
  @Output() readonly downloadRequested = new EventEmitter<string>();
  @Output() readonly selectionChanged = new EventEmitter<{ file: FileViewModel; selected: boolean }>();
}
