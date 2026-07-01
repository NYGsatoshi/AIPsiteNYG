import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-account-rail',
  standalone: true,
  template: `
    <aside class="account-rail" aria-label="アカウント">
      <div class="account-rail__brand" aria-hidden="true">A</div>
      <div class="account-rail__users" aria-label="ユーザー">
        <span class="account-rail__avatar account-rail__avatar--active">{{ initials(displayName) }}</span>
        @for (user of supportingUsers; track user) {
          <span class="account-rail__avatar">{{ initials(user) }}</span>
        }
      </div>
    </aside>
  `,
  styleUrl: './account-rail.component.scss'
})
export class AccountRailComponent {
  @Input({ required: true }) displayName = '';
  @Input() supportingUsers: readonly string[] = [];

  initials(name: string): string {
    return name.trim().slice(0, 1) || 'A';
  }
}
