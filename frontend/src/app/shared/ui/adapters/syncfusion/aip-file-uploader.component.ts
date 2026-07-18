import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AipFileUploadItem } from '../../contracts/aip-complex-adapter.contracts';

/** Syncfusion use is isolated here; upload transport remains owned by the feature Facade. */
@Component({
  selector: 'app-aip-file-uploader', standalone: true,
  template: `
    <section class="aip-uploader" [attr.aria-label]="ariaLabel" data-testid="aip-file-uploader">
      <input type="file" [multiple]="multiple" [disabled]="disabled" (change)="selected($event)" data-testid="aip-file-uploader-native" [attr.data-uploader-implementation]="syncfusionEnabled ? 'syncfusion-fallback' : 'native'" />
      <p>Files are queued locally; type, size, name, scan, and association succeed only after backend confirmation.</p>
      @for (item of items; track item.clientRequestId) { <div class="aip-uploader__item"><span>{{ item.fileName }}</span><strong>{{ item.state }}</strong>@if (item.state === 'failed') { <button type="button" (click)="retry.emit(item.clientRequestId)">Retry</button> } @if (item.state === 'pending' || item.state === 'uploading') { <button type="button" (click)="cancel.emit(item.clientRequestId)">Cancel</button> }</div> }
    </section>`,
  styles: [`.aip-uploader{display:grid;gap:var(--aip-space-2);padding:var(--aip-space-4);border:1px dashed var(--aip-color-border-strong);border-radius:var(--aip-radius-lg);background:var(--aip-color-bg-surface-subtle)}.aip-uploader p{margin:0;color:var(--aip-color-text-secondary);font-size:var(--aip-font-size-sm)}.aip-uploader__item{display:flex;gap:var(--aip-space-2);align-items:center;justify-content:space-between}.aip-uploader__item span{overflow-wrap:anywhere}.aip-uploader button{min-height:var(--aip-control-height)}`],
})
export class AipFileUploaderComponent {
  @Input() items: readonly AipFileUploadItem[] = [];
  @Input() multiple = false;
  @Input() disabled = false;
  @Input() syncfusionEnabled = false;
  @Input() ariaLabel = 'File uploader';
  @Output() readonly filesSelected = new EventEmitter<readonly File[]>();
  @Output() readonly retry = new EventEmitter<string>();
  @Output() readonly cancel = new EventEmitter<string>();
  selected(event: { filesData?: readonly { rawFile?: File }[] } | Event): void {
    const files = event instanceof Event
      ? Array.from((event.target as HTMLInputElement).files ?? [])
      : (event.filesData ?? []).map((entry) => entry.rawFile).filter((file): file is File => !!file);
    if (files.length) { this.filesSelected.emit(files); }
  }
}
