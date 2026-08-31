import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

export interface AipFileUploaderItem {
  readonly clientRequestId: string;
  readonly fileName: string;
  readonly state: 'pending' | 'uploading' | 'succeeded' | 'failed' | 'cancelled';
  readonly message?: string;
}

@Component({
  selector: 'app-aip-file-uploader',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="aip-uploader"
      [class.aip-uploader--disabled]="disabled"
      [attr.aria-label]="ariaLabel"
      [attr.data-adapter]="syncfusionEnabled ? 'syncfusion' : 'native-fallback'"
      (dragover)="handleDragOver($event)"
      (drop)="handleDrop($event)"
    >
      <input
        #fileInput
        class="aip-uploader__input"
        type="file"
        [attr.aria-label]="ariaLabel"
        [multiple]="multiple"
        [disabled]="disabled"
        (change)="handleInputChange($event)"
      />

      <div class="aip-uploader__prompt">
        <strong>Upload files</strong>
        <span>Drop files here or choose them from this device. File policy is enforced by the backend.</span>
        <button type="button" [disabled]="disabled" (click)="fileInput.click()">Choose files</button>
      </div>

      @if (items.length > 0) {
        <ul class="aip-uploader__queue" aria-label="Upload queue">
          @for (item of items; track item.clientRequestId) {
            <li>
              <div>
                <strong>{{ item.fileName }}</strong>
                <span>{{ stateLabel(item.state) }}</span>
                @if (item.message) {
                  <small>{{ item.message }}</small>
                }
              </div>

              @if (item.state === 'pending' || item.state === 'uploading') {
                <button type="button" [disabled]="disabled" (click)="cancel.emit(item.clientRequestId)">Cancel</button>
              } @else if (item.state === 'failed' || item.state === 'cancelled') {
                <button type="button" [disabled]="disabled" (click)="retry.emit(item.clientRequestId)">Retry</button>
              }
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: [`
    :host { display: block; min-width: 0; container-type: inline-size; }
    .aip-uploader { min-width: 0; border: 1px dashed var(--aip-color-border-strong); border-radius: 0.75rem; padding: 1rem; background: var(--aip-color-bg-elevated); color: var(--aip-color-text-primary); }
    .aip-uploader--disabled { opacity: 0.65; }
    .aip-uploader__input { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .aip-uploader__prompt { display: grid; justify-items: start; gap: 0.5rem; }
    .aip-uploader__prompt span, .aip-uploader__queue span, .aip-uploader__queue small { color: var(--aip-color-text-secondary); }
    button { min-height: 2.5rem; border: 1px solid var(--aip-color-border-strong); border-radius: 0.5rem; padding: 0.5rem 0.9rem; background: var(--aip-color-bg-surface-subtle); color: var(--aip-color-text-primary); cursor: pointer; }
    button:hover:not(:disabled) { background: var(--aip-color-bg-hover); }
    button:focus-visible { outline: var(--aip-focus-outline); outline-offset: var(--aip-focus-offset); }
    button:disabled { cursor: not-allowed; opacity: 0.55; }
    .aip-uploader__queue { display: grid; gap: 0.5rem; margin: 1rem 0 0; padding: 0; list-style: none; }
    .aip-uploader__queue li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; min-width: 0; border-top: 1px solid var(--aip-color-border-default); padding-top: 0.75rem; }
    .aip-uploader__queue li > div { display: grid; flex: 1 1 12rem; gap: 0.2rem; min-width: 0; }
    .aip-uploader__queue strong, .aip-uploader__queue span, .aip-uploader__queue small { overflow-wrap: anywhere; }
    @container (max-width: 26rem) { .aip-uploader__queue li > button { width: 100%; } }
  `]
})
export class AipFileUploaderComponent {
  @Input() ariaLabel = 'File uploader';
  @Input() items: readonly AipFileUploaderItem[] = [];
  @Input() multiple = false;
  @Input() disabled = false;
  @Input() syncfusionEnabled = false;

  @Output() readonly filesSelected = new EventEmitter<readonly File[]>();
  @Output() readonly cancel = new EventEmitter<string>();
  @Output() readonly retry = new EventEmitter<string>();

  handleInputChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    this.emitFiles(target.files);
    target.value = '';
  }

  handleDragOver(event: DragEvent): void {
    if (this.disabled) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  handleDrop(event: DragEvent): void {
    if (this.disabled) {
      return;
    }

    event.preventDefault();
    this.emitFiles(event.dataTransfer?.files ?? null);
  }

  stateLabel(state: AipFileUploaderItem['state']): string {
    switch (state) {
      case 'pending': return 'Pending';
      case 'uploading': return 'Uploading';
      case 'succeeded': return 'Uploaded';
      case 'failed': return 'Failed';
      case 'cancelled': return 'Cancelled';
    }
  }

  private emitFiles(fileList: FileList | null): void {
    if (this.disabled || !fileList || fileList.length === 0) {
      return;
    }

    const selected = Array.from(fileList);
    this.filesSelected.emit(this.multiple ? selected : selected.slice(0, 1));
  }
}
