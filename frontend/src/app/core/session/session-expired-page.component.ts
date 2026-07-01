import { Component } from '@angular/core';

@Component({
  selector: 'app-session-expired-page',
  standalone: true,
  template: `
    <main class="session-expired" aria-labelledby="session-expired-title">
      <h1 id="session-expired-title">セッションの有効期限が切れました。もう一度ログインしてください。</h1>
    </main>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
        background: #f6f8fb;
        color: #17202a;
      }

      .session-expired {
        display: grid;
        min-height: 100vh;
        place-items: center;
        padding: 24px;
      }

      h1 {
        margin: 0;
        max-width: 640px;
        font-size: clamp(1.25rem, 4vw, 1.75rem);
        font-weight: 700;
        line-height: 1.5;
        text-align: center;
      }
    `
  ]
})
export class SessionExpiredPageComponent {}
