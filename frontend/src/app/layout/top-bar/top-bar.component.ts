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
    <header class="top-bar" data-testid="top-bar" aria-label="Primary workspace header">
      <div class="top-bar__workspace">
        <span class="top-bar__label">Workspace</span>
        <strong>{{ workspace?.label || 'Not selected' }}</strong>
      </div>
      <label class="top-bar__search">
        <span>Page search</span>
        <input
          type="search"
          data-testid="page-search"
          [value]="searchValue"
          readonly
          aria-readonly="true"
          aria-describedby="page-search-status"
          title="Search is not available in MVP0 yet."
          placeholder="Search not available in MVP0"
          autocomplete="off"
        />
        <span id="page-search-status" class="top-bar__assistive-text">Page search is not available in MVP0 yet.</span>
      </label>
      <div class="top-bar__actions">
        @if (sessionStatus === 'expired') {
          <span class="top-bar__status">Session expired</span>
        }
        @if (logoutError) {
          <span class="top-bar__status top-bar__status--error" data-testid="logout-error">{{ logoutError }}</span>
        }
        <button
          type="button"
          class="top-bar__logout-button"
          data-testid="logout-action"
          [disabled]="logoutPending"
          (click)="logoutRequested.emit()"
        >
          {{ logoutPending ? 'Logging out' : 'Logout' }}
        </button>
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
  @Input() logoutPending = false;
  @Input() logoutError = '';
  @Output() searchValueChange = new EventEmitter<string>();
  @Output() rightPanelToggle = new EventEmitter<HTMLElement>();
  @Output() logoutRequested = new EventEmitter<void>();
}
