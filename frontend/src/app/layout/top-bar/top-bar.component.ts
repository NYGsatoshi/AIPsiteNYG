import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AuthSessionStatus } from '../../core/auth/auth-session.facade';
import { WorkspaceSummary } from '../../core/workspace/active-workspace.facade';
import { RightPanelMode } from '../app-shell/app-shell.facade';

@Component({
  selector: 'app-top-bar',
  standalone: true,
  imports: [FormsModule],
  template: `
    <header class="top-bar">
      <div class="top-bar__workspace">
        <span class="top-bar__label">場所</span>
        <strong>{{ workspace?.label || '未選択' }}</strong>
      </div>
      <label class="top-bar__search">
        <span>ページ内検索</span>
        <input
          type="search"
          [ngModel]="searchValue"
          (ngModelChange)="searchValueChange.emit($event)"
          placeholder="準備中"
          autocomplete="off"
        />
      </label>
      <div class="top-bar__actions">
        @if (sessionStatus === 'expired') {
          <span class="top-bar__status">期限切れ</span>
        }
        <button type="button" class="top-bar__panel-button" (click)="rightPanelToggle.emit()">
          {{ rightPanelMode === 'expanded' ? '閉じる' : '詳細' }}
        </button>
      </div>
    </header>
  `,
  styleUrl: './top-bar.component.scss'
})
export class TopBarComponent {
  @Input() workspace: WorkspaceSummary | null = null;
  @Input() searchValue = '';
  @Input() sessionStatus: AuthSessionStatus = 'active';
  @Input() rightPanelMode: RightPanelMode = 'collapsed';
  @Output() searchValueChange = new EventEmitter<string>();
  @Output() rightPanelToggle = new EventEmitter<void>();
}
