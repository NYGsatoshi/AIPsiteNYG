import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AuthSessionStatus } from '../../core/auth/auth-session.facade';
import { WorkspaceSummary } from '../../core/workspace/active-workspace.facade';
import { RightPanelMode } from '../../shared/right-panel/right-panel.types';

@Component({
  selector: 'app-top-bar',
  standalone: true,
  imports: [FormsModule],
  template: `
    <header class="top-bar" data-testid="top-bar">
      <div class="top-bar__workspace">
        <span class="top-bar__label">Workspace</span>
        <strong>{{ workspace?.label || 'Not selected' }}</strong>
      </div>
      <label class="top-bar__search">
        <span>Page search</span>
        <input
          type="search"
          data-testid="page-search"
          [ngModel]="searchValue"
          (ngModelChange)="searchValueChange.emit($event)"
          placeholder="Search this page"
          autocomplete="off"
        />
      </label>
      <div class="top-bar__actions">
        @if (sessionStatus === 'expired') {
          <span class="top-bar__status">Session expired</span>
        }
        <button
          #rightPanelButton
          type="button"
          class="top-bar__panel-button"
          data-testid="right-panel-toggle"
          aria-controls="right-panel-region"
          [attr.aria-expanded]="rightPanelMode === 'expanded' || rightPanelMode === 'drawer'"
          (click)="rightPanelToggle.emit(rightPanelButton)"
        >
          {{ rightPanelMode === 'expanded' || rightPanelMode === 'drawer' ? 'Close details' : 'Details' }}
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
  @Output() rightPanelToggle = new EventEmitter<HTMLElement>();
}
