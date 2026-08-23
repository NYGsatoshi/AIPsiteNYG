import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AuthSessionStatus } from '../../core/auth/auth-session.facade';
import { WorkspaceSummary } from '../../core/workspace/active-workspace.facade';
import { RightPanelMode } from '../../shared/right-panel/right-panel.types';

@Component({
  selector: 'app-top-bar',
  standalone: true,
  imports: [RouterLink],
  template: `
    <header class="top-bar" data-testid="top-bar" aria-label="Primary workspace header">
      <section class="top-bar__workspace" aria-labelledby="workspace-context-label">
        <label id="workspace-context-label" class="top-bar__label" for="workspace-switcher">
          Workspace
        </label>
        <select
          id="workspace-switcher"
          data-testid="workspace-switcher"
          aria-describedby="workspace-selection-status"
          [disabled]="workspaceSelectionStatus === 'loading' || workspaceSelectionStatus === 'unavailable'"
          (change)="onWorkspaceChange($event)"
        >
          @if (!workspace || workspaceSelectionStatus === 'selectionRequired') {
            <option value="" [selected]="!workspace">Select a Workspace</option>
          }
          @for (option of workspaceOptions; track option.id) {
            <option [value]="option.id" [selected]="option.id === workspace?.id">{{ option.label }}</option>
          }
        </select>
        <span
          id="workspace-selection-status"
          class="top-bar__selection-status"
          data-testid="workspace-selection-status"
          aria-live="polite"
        >
          @switch (workspaceSelectionStatus) {
            @case ('loading') { Loading Workspaces }
            @case ('selectionRequired') { Choose a Workspace to continue }
            @case ('unavailable') { Workspace unavailable }
            @default { {{ workspace?.label || 'Workspace not selected' }} }
          }
        </span>
      </section>

      <section class="top-bar__research" aria-label="Research status" aria-live="polite">
        <span class="top-bar__label">Research</span>
        <strong data-testid="workspace-research-status">
          @if (runningProjectCount !== null && needsReviewProjectCount !== null) {
            {{ runningProjectCount }} Running <span aria-hidden="true">&middot;</span>
            {{ needsReviewProjectCount }} Needs review
          } @else {
            Status unavailable
          }
        </strong>
      </section>

      <div class="top-bar__actions">
        @if (sessionStatus === 'expired') {
          <span class="top-bar__status">Session expired</span>
        }
        @if (logoutError) {
          <span class="top-bar__status top-bar__status--error" data-testid="logout-error">{{ logoutError }}</span>
        }
        @if (workspace && canOpenWorkspaceMembers) {
          <nav class="top-bar__action-group" aria-label="Workspace actions">
            <a
              class="top-bar__action"
              data-testid="workspace-members-action"
              [routerLink]="['/workspaces', workspace.id, 'members']"
            >Members</a>
          </nav>
        }
        <nav class="top-bar__action-group top-bar__action-group--global" aria-label="Global actions">
          <button
            #rightPanelButton
            type="button"
            class="top-bar__action"
            data-testid="right-panel-toggle"
            aria-controls="right-panel-region"
            [attr.aria-expanded]="rightPanelMode === 'expanded' || rightPanelMode === 'drawer'"
            (click)="rightPanelToggle.emit(rightPanelButton)"
          >
            {{ rightPanelMode === 'expanded' || rightPanelMode === 'drawer' ? 'Close notifications' : 'Notifications' }}
          </button>
          <a class="top-bar__action" data-testid="account-action" routerLink="/account">Account</a>
          <button
            type="button"
            class="top-bar__action top-bar__action--logout"
            data-testid="logout-action"
            [disabled]="logoutPending"
            (click)="logoutRequested.emit()"
          >
            {{ logoutPending ? 'Logging out' : 'Logout' }}
          </button>
        </nav>
      </div>
    </header>
  `,
  styleUrl: './top-bar.component.scss'
})
export class TopBarComponent {
  @Input() workspace: WorkspaceSummary | null = null;
  @Input() workspaceOptions: readonly WorkspaceHeaderOption[] = [];
  @Input() workspaceSelectionStatus: WorkspaceHeaderSelectionStatus = 'unavailable';
  @Input() runningProjectCount: number | null = null;
  @Input() needsReviewProjectCount: number | null = null;
  @Input() canOpenWorkspaceMembers = false;
  @Input() sessionStatus: AuthSessionStatus = 'active';
  @Input() rightPanelMode: RightPanelMode = 'collapsed';
  @Input() logoutPending = false;
  @Input() logoutError = '';
  @Output() workspaceSelected = new EventEmitter<string>();
  @Output() rightPanelToggle = new EventEmitter<HTMLElement>();
  @Output() logoutRequested = new EventEmitter<void>();

  onWorkspaceChange(event: Event): void {
    const value = event.target instanceof HTMLSelectElement ? event.target.value : '';
    if (value && value !== this.workspace?.id) {
      this.workspaceSelected.emit(value);
    }
  }
}

export interface WorkspaceHeaderOption {
  readonly id: string;
  readonly label: string;
}

export type WorkspaceHeaderSelectionStatus =
  | 'loading'
  | 'selected'
  | 'selectionRequired'
  | 'unavailable';
