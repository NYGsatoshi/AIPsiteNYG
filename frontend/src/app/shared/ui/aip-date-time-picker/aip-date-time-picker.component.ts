import { Component, EventEmitter, Input, Output } from '@angular/core';

/** Maps the existing datetime-local UI to an explicit UTC ISO instant. */
@Component({
  selector: 'app-aip-date-time-picker', standalone: true,
  template: `<input type="datetime-local" [attr.aria-label]="ariaLabel" [value]="localValue" [disabled]="disabled" (change)="changed($any($event.target).value)" data-testid="aip-date-time-picker" />`,
  styles: [`input{min-height:var(--aip-control-height);box-sizing:border-box;border:1px solid var(--aip-color-border-default);border-radius:var(--aip-radius-md);background:var(--aip-color-bg-surface);color:var(--aip-color-text-primary);padding:0 var(--aip-space-2);font:inherit}`],
})
export class AipDateTimePickerComponent {
  @Input() value: string | null = null;
  @Input() disabled = false;
  @Input() ariaLabel = 'Date and time';
  @Output() readonly valueChanged = new EventEmitter<string | null>();
  get localValue(): string {
    if (!this.value) { return ''; }
    const date = new Date(this.value);
    if (Number.isNaN(date.getTime())) { return ''; }
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }
  changed(value: string): void {
    if (!value) { this.valueChanged.emit(null); return; }
    const date = new Date(value);
    this.valueChanged.emit(Number.isNaN(date.getTime()) ? null : date.toISOString());
  }
}
