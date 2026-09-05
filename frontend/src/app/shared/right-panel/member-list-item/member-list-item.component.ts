import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { RightPanelMember } from '../right-panel.types';

@Component({
  selector: 'li[app-member-list-item]',
  standalone: true,
  template: `
    <div class="member__avatar" aria-hidden="true">{{ initials }}</div>
    <div class="member__body">
      <div class="member__line">
        <strong class="member__name">{{ member.displayName }}</strong>
        <span class="member__status">{{ member.accountStatus }}</span>
      </div>
      <p class="member__meta">{{ member.role }} / {{ member.groupLabel }}</p>
      @if (member.availability) {
        <p class="member__availability">静的モック: {{ member.availability }}</p>
      }
    </div>
  `,
  styleUrl: './member-list-item.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager
})
export class MemberListItemComponent {
  @Input({ required: true }) member!: RightPanelMember;

  get initials(): string {
    return this.member.displayName.slice(0, 2);
  }
}
