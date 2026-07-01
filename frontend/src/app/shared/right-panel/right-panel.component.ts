import { Component, Input } from '@angular/core';

import { AuthSessionSnapshot } from '../../core/auth/auth-session.facade';
import { WorkspaceSummary } from '../../core/workspace/active-workspace.facade';
import { RightPanelMode } from '../../layout/app-shell/app-shell.facade';

@Component({
  selector: 'app-right-panel',
  standalone: true,
  template: `
    <aside class="right-panel" [class.right-panel--expanded]="mode === 'expanded'" aria-label="詳細">
      <h2>詳細</h2>
      @if (mode === 'expanded') {
        <dl>
          <div>
            <dt>状態</dt>
            <dd>{{ session.status === 'expired' ? '期限切れ' : '有効' }}</dd>
          </div>
          <div>
            <dt>場所</dt>
            <dd>{{ workspace?.label || '未選択' }}</dd>
          </div>
          <div>
            <dt>通知</dt>
            <dd>確認のみ</dd>
          </div>
        </dl>
      }
    </aside>
  `,
  styleUrl: './right-panel.component.scss'
})
export class RightPanelComponent {
  @Input({ required: true }) session!: AuthSessionSnapshot;
  @Input() workspace: WorkspaceSummary | null = null;
  @Input() mode: RightPanelMode = 'collapsed';
}
