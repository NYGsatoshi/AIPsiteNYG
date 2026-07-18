import { AfterViewChecked, Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';

/**
 * AIPsite-owned dialog surface.  It deliberately exposes no vendor instance
 * or DOM contract to feature code; the native dialog is the maintained
 * rollback implementation for this migration wave.
 */
@Component({
  selector: 'app-aip-dialog',
  standalone: true,
  template: `
    @if (open) {
      <dialog #dialog class="aip-dialog" aria-modal="true" [attr.aria-labelledby]="titleId" [attr.aria-describedby]="description ? descriptionId : null" (cancel)="onNativeCancel($event)" (close)="closed.emit()">
        <form method="dialog" class="aip-dialog__surface">
          <header><h2 [id]="titleId">{{ title }}</h2>@if (description) { <p [id]="descriptionId">{{ description }}</p> }</header>
          <section class="aip-dialog__body"><ng-content /></section>
          <footer>
            <button type="button" (click)="cancel.emit()" [disabled]="busy">{{ cancelLabel }}</button>
            <button type="button" [class.aip-dialog__confirm--danger]="destructive" (click)="confirm.emit()" [disabled]="busy">{{ busy ? 'Working…' : confirmLabel }}</button>
          </footer>
        </form>
      </dialog>
    }
  `,
  styles: [`.aip-dialog{border:0;background:transparent;padding:0;max-width:min(34rem,calc(100vw - 2rem));color:var(--aip-color-text-primary)}.aip-dialog::backdrop{background:var(--aip-color-overlay)}.aip-dialog__surface{display:grid;gap:var(--aip-space-4);padding:var(--aip-space-5);border:1px solid var(--aip-color-border-default);border-radius:var(--aip-radius-lg);background:var(--aip-color-bg-elevated);box-shadow:var(--aip-shadow-3)}.aip-dialog h2,.aip-dialog p{margin:0}.aip-dialog p{color:var(--aip-color-text-secondary)}.aip-dialog__body{display:grid;gap:var(--aip-space-3)}.aip-dialog footer{display:flex;justify-content:end;gap:var(--aip-space-2)}button{min-height:var(--aip-control-height);border-radius:var(--aip-radius-md);padding:0 var(--aip-space-3);font:inherit}button:last-child{border:1px solid var(--aip-color-action-primary);background:var(--aip-color-action-primary);color:var(--aip-color-text-inverse)}.aip-dialog__confirm--danger{border-color:var(--aip-color-danger)!important;background:var(--aip-color-danger)!important}@media(max-width:600px){.aip-dialog{width:calc(100vw - 1rem);max-width:none}.aip-dialog__surface{border-radius:var(--aip-radius-lg)}}`],
})
export class AipDialogComponent implements AfterViewChecked {
  @Input({ required: true }) title = '';
  @Input() description = '';
  @Input() open = false;
  @Input() closeOnEscape = true;
  @Input() destructive = false;
  @Input() busy = false;
  @Input() confirmLabel = 'Confirm';
  @Input() cancelLabel = 'Cancel';
  @Output() readonly confirm = new EventEmitter<void>();
  @Output() readonly cancel = new EventEmitter<void>();
  @Output() readonly closed = new EventEmitter<void>();
  @ViewChild('dialog') private dialog?: ElementRef<HTMLDialogElement>;
  readonly titleId = `aip-dialog-title-${crypto.randomUUID()}`;
  readonly descriptionId = `aip-dialog-description-${crypto.randomUUID()}`;

  ngAfterViewChecked(): void {
    const dialog = this.dialog?.nativeElement;
    if (this.open && dialog && !dialog.open) { dialog.showModal(); }
  }

  onNativeCancel(event: Event): void {
    if (!this.closeOnEscape || this.busy) { event.preventDefault(); return; }
    event.preventDefault();
    this.cancel.emit();
  }
}
