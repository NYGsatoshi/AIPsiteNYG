import { Component } from '@angular/core';

@Component({
  selector: 'app-thread-preview',
  standalone: true,
  template: `
    <aside class="thread-preview" data-testid="thread-preview">
      <strong>スレッド</strong>
      <span>本文プレビューなし</span>
    </aside>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .thread-preview {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        border: 1px solid #d4dde8;
        border-radius: 8px;
        padding: 10px 12px;
        background: #f8fafc;
        color: #526173;
        font-size: 0.88rem;
      }
    `
  ]
})
export class ThreadPreviewComponent {}
