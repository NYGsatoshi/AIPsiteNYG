import { ChangeDetectionStrategy, Component, EventEmitter, HostListener, Input, Output } from '@angular/core';

@Component({
  selector: 'app-aip-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open) {
      <div class="aip-dialog__backdrop" (mousedown)="handleBackdrop($event)">
        <section
          class="aip-dialog"
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="title"
          (mousedown)="$event.stopPropagation()"
        >
          <header class="aip-dialog__header">
            <div>
              <h2>{{ title }}</h2>
              @if (description) {
                <p>{{ description }}</p>
              }
            </div>
            <button type="button" class="aip-dialog__close" [disabled]="busy" aria-label="Close dialog" (click)="requestCancel()">×</button>
          </header>

          <div class="aip-dialog__content">
            <ng-content />
          </div>

          <footer class="aip-dialog__actions">
            <button type="button" [disabled]="busy" (click)="requestCancel()">{{ cancelLabel }}</button>
            <button
              type="button"
              class="aip-dialog__confirm"
              [class.aip-dialog__confirm--destructive]="destructive"
              [disabled]="busy"
              (click)="confirm.emit()"
            >
              {{ busy ? 'Working…' : confirmLabel }}
            </button>
          </footer>
        </section>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .aip-dialog__backdrop { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 1rem; background: rgb(0 0 0 / 58%); }
    .aip-dialog { width: min(42rem, 100%); max-height: min(48rem, calc(100vh - 2rem)); overflow: auto; border: 1px solid var(--aip-border-subtle, #48505e); border-radius: var(--aip-radius-lg, 0.75rem); background: var(--aip-surface-raised, #171b22); color: var(--aip-text-primary, #f4f7fb); box-shadow: 0 1.5rem 4rem rgb(0 0 0 / 45%); }
    .aip-dialog__header, .aip-dialog__actions { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding: 1rem 1.25rem; }
    .aip-dialog__header { border-bottom: 1px solid var(--aip-border-subtle, #48505e); }
    .aip-dialog__header h2, .aip-dialog__header p { margin: 0; }
    .aip-dialog__header p { margin-top: 0.35rem; color: var(--aip-text-secondary, #b8c0cc); }
    .aip-dialog__content { padding: 1.25rem; }
    .aip-dialog__actions { justify-content: flex-end; border-top: 1px solid var(--aip-border-subtle, #48505e); }
    button { min-height: 2.5rem; border: 1px solid var(--aip-border-strong, #687282); border-radius: 0.5rem; padding: 0.5rem 0.9rem; background: var(--aip-surface-interactive, #242b35); color: inherit; cursor: pointer; }
    button:disabled { cursor: not-allowed; opacity: 0.55; }
    .aip-dialog__close { min-width: 2.5rem; padding: 0.25rem; font-size: 1.35rem; }
    .aip-dialog__confirm { border-color: var(--aip-accent, #5794ff); background: var(--aip-accent, #2764c5); }
    .aip-dialog__confirm--destructive { border-color: var(--aip-danger, #e26565); background: var(--aip-danger-strong, #a93232); }
  `]
})
export class AipDialogComponent {
  @Input() open = false;
  @Input() title = 'Dialog';
  @Input() description: string | null = null;
  @Input() confirmLabel = 'Confirm';
  @Input() cancelLabel = 'Cancel';
  @Input() busy = false;
  @Input() destructive = false;

  @Output() readonly confirm = new EventEmitter<void>();
  @Output() readonly cancel = new EventEmitter<void>();
  @Output() readonly closed = new EventEmitter<void>();

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    if (this.open) {
      this.requestCancel();
    }
  }

  handleBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.requestCancel();
    }
  }

  requestCancel(): void {
    if (this.busy) {
      return;
    }

    this.cancel.emit();
    this.closed.emit();
  }
}
