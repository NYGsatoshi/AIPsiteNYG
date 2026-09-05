import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface PageLocalSearchRow {
  readonly id: string;
  readonly searchText: string;
}

@Component({
  selector: 'app-page-local-search',
  standalone: true,
  imports: [FormsModule],
  template: `
    <label class="page-local-search">
      <span>{{ label }}</span>
      <input
        type="search"
        [ngModel]="searchValue"
        (ngModelChange)="updateSearch($event)"
        [placeholder]="placeholder"
        autocomplete="off"
      />
    </label>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .page-local-search {
        display: grid;
        gap: 0.35rem;
        color: #334155;
        font-weight: 700;
      }

      input {
        min-width: min(100%, 18rem);
        border: 1px solid #94a3b8;
        border-radius: 6px;
        padding: 0.5rem 0.625rem;
        font: inherit;
        font-weight: 400;
      }
    `,
  ],
})
export class AppPageLocalSearchComponent implements OnChanges {
  @Input() rows: readonly PageLocalSearchRow[] = [];
  @Input() searchValue = '';
  @Input() label = 'このページ内を検索';
  @Input() placeholder = '読み込み済みの項目を検索';
  @Output() searchValueChange = new EventEmitter<string>();
  @Output() filteredRowsChange = new EventEmitter<readonly PageLocalSearchRow[]>();

  filteredRows: readonly PageLocalSearchRow[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['rows'] || changes['searchValue']) {
      this.applyFilter();
    }
  }

  updateSearch(value: string): void {
    this.searchValue = value;
    this.searchValueChange.emit(value);
    this.applyFilter();
  }

  private applyFilter(): void {
    const normalizedQuery = this.searchValue.trim().toLocaleLowerCase('ja-JP');
    this.filteredRows = normalizedQuery
      ? this.rows.filter((row) =>
          row.searchText.toLocaleLowerCase('ja-JP').includes(normalizedQuery),
        )
      : [...this.rows];
    this.filteredRowsChange.emit(this.filteredRows);
  }
}
