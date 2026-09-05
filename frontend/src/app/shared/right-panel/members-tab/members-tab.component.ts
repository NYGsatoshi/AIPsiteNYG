import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { AppPermissionDeniedComponent } from '../../permission/app-permission-denied/app-permission-denied.component';
import { MemberListItemComponent } from '../member-list-item/member-list-item.component';
import { RightPanelMember, RightPanelPermission } from '../right-panel.types';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager
  selector: 'app-members-tab',
  standalone: true,
  imports: [AppPermissionDeniedComponent, MemberListItemComponent],
  template: `
    <section class="members-tab" aria-label="メンバー">
      @if (permission === 'denied') {
        <app-permission-denied title="メンバーを表示できません" />
      } @else {
        <p class="members-tab__note">現在のワークスペース、プロジェクト、会話に属するメンバーのみを表示します。</p>
        @if (members.length > 0) {
          <ul class="members-tab__list">
            @for (member of members; track member.id) {
              <li app-member-list-item [member]="member"></li>
            }
          </ul>
        } @else {
          <p class="members-tab__empty">このスコープで表示できるメンバーはありません。</p>
        }
      }
    </section>
  `,
  styleUrl: './members-tab.component.scss',
})
export class MembersTabComponent {
  @Input({ required: true }) members: readonly RightPanelMember[] = [];
  @Input() permission: RightPanelPermission = 'granted';
}
