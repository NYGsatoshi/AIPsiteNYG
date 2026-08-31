import { A11yModule } from '@angular/cdk/a11y';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges
} from '@angular/core';

@Component({
  selector: 'app-aip-dialog',
  standalone: true,
  imports: [A11yModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open) {
      <div class="aip-dialog__backdrop" (mousedown)="handleBackdrop($event)">
        <section
          class="aip-dialog"
          [class.aip-dialog--wide]="size === 'wide'"
          role="dialog"
          aria-modal="true"
          [attr.aria-labelledby]="titleId"
          [attr.aria-describedby]="description ? descriptionId : null"
          [attr.aria-busy]="busy"
          tabindex="-1"
          [cdkTrapFocus]="open"
          [cdkTrapFocusAutoCapture]="open"
          (mousedown)="$event.stopPropagation()"
        >
          <header class="aip-dialog__header">
            <div>
              <h2 [id]="titleId">{{ title }}</h2>
              @if (description) {
                <p [id]="descriptionId">{{ description }}</p>
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
              [attr.type]="confirmForm ? 'submit' : 'button'"
              [attr.form]="confirmForm"
              class="aip-dialog__confirm"
              [class.aip-dialog__confirm--destructive]="destructive"
              [disabled]="busy || confirmDisabled"
              (click)="requestConfirm()"
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
    .aip-dialog__backdrop { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 1rem; background: var(--aip-color-overlay, rgb(0 0 0 / 58%)); }
    .aip-dialog { width: min(42rem, 100%); max-height: min(48rem, calc(100vh - 2rem)); overflow: auto; border: 1px solid var(--aip-color-border-default, #48505e); border-radius: var(--aip-radius-lg, 0.75rem); background: var(--aip-color-bg-elevated, #171b22); color: var(--aip-color-text-primary, #f4f7fb); box-shadow: var(--aip-shadow-floating, 0 1.5rem 4rem rgb(0 0 0 / 45%)); }
    .aip-dialog--wide { width: min(72rem, 100%); }
    .aip-dialog__header, .aip-dialog__actions { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding: 1rem 1.25rem; }
    .aip-dialog__header { border-bottom: 1px solid var(--aip-color-border-default, #48505e); }
    .aip-dialog__header h2, .aip-dialog__header p { margin: 0; }
    .aip-dialog__header p { margin-top: 0.35rem; color: var(--aip-color-text-secondary, #b8c0cc); }
    .aip-dialog__content { padding: 1.25rem; }
    .aip-dialog__actions { justify-content: flex-end; border-top: 1px solid var(--aip-color-border-default, #48505e); }
    button { min-height: 2.75rem; border: 1px solid var(--aip-color-border-strong, #687282); border-radius: 0.5rem; padding: 0.5rem 0.9rem; background: var(--aip-color-bg-control, #242b35); color: var(--aip-color-text-primary, inherit); cursor: pointer; }
    button:focus-visible { outline: 3px solid var(--aip-color-focus, #79a9ff); outline-offset: 2px; }
    button:disabled { cursor: not-allowed; opacity: 0.55; }
    .aip-dialog__close { min-width: 2.75rem; padding: 0.25rem; font-size: 1.35rem; }
    .aip-dialog__confirm { border-color: var(--aip-color-action-primary, #5794ff); background: var(--aip-color-action-primary, #2764c5); color: var(--aip-color-text-inverse, #fff); }
    .aip-dialog__confirm--destructive { border-color: var(--aip-color-danger, #e26565); background: var(--aip-color-danger, #a93232); color: var(--aip-color-text-inverse, #fff); }
  `]
})
export class AipDialogComponent implements OnChanges {
  private static nextInstanceId = 0;

  private readonly instanceId = AipDialogComponent.nextInstanceId++;
  private invocationFocus: HTMLElement | null = null;
  private focusTransition = 0;

  @Input() open = false;
  @Input() title = 'Dialog';
  @Input() description: string | null = null;
  @Input() titleId = `aip-dialog-title-${this.instanceId}`;
  @Input() descriptionId = `aip-dialog-description-${this.instanceId}`;
  @Input() confirmLabel = 'Confirm';
  @Input() cancelLabel = 'Cancel';
  @Input() confirmForm: string | null = null;
  @Input() focusReturnFallbackId: string | null = null;
  @Input() busy = false;
  @Input() confirmDisabled = false;
  @Input() destructive = false;
  @Input() size: 'default' | 'wide' = 'default';

  @Output() readonly confirm = new EventEmitter<void>();
  @Output() readonly cancel = new EventEmitter<void>();
  @Output() readonly closed = new EventEmitter<void>();

  ngOnChanges(changes: SimpleChanges): void {
    const openChange = changes['open'];
    if (!openChange || openChange.firstChange || openChange.previousValue === openChange.currentValue) {
      return;
    }

    if (openChange.currentValue) {
      this.focusTransition += 1;
      const activeElement = document.activeElement;
      this.invocationFocus = activeElement instanceof HTMLElement ? activeElement : null;
      return;
    }

    const transition = ++this.focusTransition;
    const returnFocusTo = this.invocationFocus;
    this.invocationFocus = null;

    queueMicrotask(() => {
      if (this.focusTransition !== transition || this.open) {
        return;
      }

      const focusTarget = returnFocusTo?.isConnected
        ? returnFocusTo
        : this.focusReturnFallbackId
          ? document.getElementById(this.focusReturnFallbackId)
          : null;
      focusTarget?.focus();
    });
  }

  @HostListener('document:keydown.escape', ['$event'])
  handleEscape(event: KeyboardEvent): void {
    if (!this.open) {
      return;
    }

    event.preventDefault();
    this.requestCancel();
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

  requestConfirm(): void {
    if (this.busy || this.confirmDisabled) {
      return;
    }

    if (!this.confirmForm) {
      this.confirm.emit();
    }
  }
}
