import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';

interface PagePlaceholderViewModel {
  readonly title: string;
  readonly summary: string;
  readonly tone: string;
}

@Component({
  selector: 'app-page-placeholder',
  standalone: true,
  imports: [AsyncPipe],
  template: `
    @if (page$ | async; as page) {
      <section class="page-placeholder" [attr.data-tone]="page.tone" aria-labelledby="page-placeholder-title">
        <p class="page-placeholder__eyebrow">MVP-A P0</p>
        <h1 id="page-placeholder-title">{{ page.title }}</h1>
        <p>{{ page.summary }}</p>
      </section>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .page-placeholder {
        display: grid;
        gap: 8px;
        max-width: 720px;
        border: 1px solid var(--shell-border-color, #d9e0e8);
        border-radius: var(--shell-radius-lg, 8px);
        background: #ffffff;
        padding: clamp(20px, 5vw, 40px);
      }

      .page-placeholder__eyebrow,
      h1,
      p {
        margin: 0;
      }

      .page-placeholder__eyebrow {
        color: #4b647c;
        font-size: 0.75rem;
        font-weight: 700;
      }

      h1 {
        color: #17202a;
        font-size: 1.75rem;
        line-height: 1.25;
      }

      p {
        color: #52616f;
        line-height: 1.7;
      }
    `
  ]
})
export class PagePlaceholderComponent {
  private readonly route = inject(ActivatedRoute);

  readonly page$ = this.route.data.pipe(
    map(
      (data): PagePlaceholderViewModel => ({
        title: typeof data['title'] === 'string' ? data['title'] : '未実装',
        summary: typeof data['summary'] === 'string' ? data['summary'] : '準備中',
        tone: typeof data['tone'] === 'string' ? data['tone'] : 'default'
      })
    )
  );
}
