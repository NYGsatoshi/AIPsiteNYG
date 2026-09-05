import {
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import { FileRowComponent } from '../file-row/file-row.component';
import { FileViewModel } from '../files.types';

@Component({
  selector: 'app-recent-files-list',
  standalone: true,
  imports: [FileRowComponent],
  templateUrl: './recent-files-list.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './recent-files-list.component.scss',
})
export class RecentFilesListComponent {
  readonly i18n = inject(I18nService);

  @Input({ required: true }) files: readonly FileViewModel[] = [];
  @Input() selectedFileIds: ReadonlySet<string> = new Set();
  @Output() readonly previewRequested = new EventEmitter<FileViewModel>();
  @Output() readonly downloadRequested = new EventEmitter<string>();
  @Output() readonly selectionChanged = new EventEmitter<{
    file: FileViewModel;
    selected: boolean;
  }>();
}
