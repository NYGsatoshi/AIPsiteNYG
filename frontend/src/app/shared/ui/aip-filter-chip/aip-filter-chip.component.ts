import { Component, EventEmitter, Input, Output, inject } from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';

@Component({
  selector: 'app-aip-filter-chip',
  standalone: true,
  template: `
    <span class="aip-filter-chip" data-testid="filter-chip">
      <span class="aip-filter-chip__text"><strong>{{ label }}:</strong> {{ value }}</span>
      <button
        type="button"
        class="aip-filter-chip__remove"
        [attr.aria-label]="i18n.translate('common.removeFilter', { label, value })"
        (click)="removed.emit()"
      ><span aria-hidden="true">&times;</span></button>
    </span>
  `,
  styles: `
    :host { display: inline-flex; min-width: 0; }
    .aip-filter-chip {
      display: inline-flex;
      align-items: center;
      max-width: 100%;
      min-height: 36px;
      border: 1px solid var(--aip-color-border-strong);
      border-radius: 999px;
      background: var(--aip-color-bg-selected);
      color: var(--aip-color-text-primary);
      font-size: 0.8rem;
      line-height: 1.2;
    }
    .aip-filter-chip__text {
      min-width: 0;
      padding: 7px 4px 7px 11px;
      overflow-wrap: anywhere;
    }
    .aip-filter-chip__remove {
      display: inline-grid;
      place-items: center;
      width: 36px;
      min-width: 36px;
      min-height: 36px;
      border: 0;
      border-radius: 999px;
      padding: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      font-size: 1.05rem;
      font-weight: 900;
    }
    .aip-filter-chip__remove:hover { background: var(--aip-color-bg-hover); }
    .aip-filter-chip__remove:focus-visible {
      outline: 3px solid var(--aip-color-focus, #2f6feb);
      outline-offset: 1px;
    }
  `,
})
export class AipFilterChipComponent {
  protected readonly i18n = inject(I18nService);

  @Input({ required: true }) label = '';
  @Input({ required: true }) value = '';
  @Output() readonly removed = new EventEmitter<void>();
}
