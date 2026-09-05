import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { WorkspaceQuickActionsComponent } from '../workspace-quick-actions/workspace-quick-actions.component';
import { WorkspaceCardViewModel } from '../workspaces.types';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager
  selector: 'app-workspace-card',
  standalone: true,
  imports: [WorkspaceQuickActionsComponent],
  templateUrl: './workspace-card.component.html',
  styleUrl: './workspace-card.component.scss',
})
export class WorkspaceCardComponent {
  @Input({ required: true }) workspace!: WorkspaceCardViewModel;

  unavailableLabel(available: boolean, value: number | string | null): string {
    return available && value !== null ? String(value) : '未提供';
  }
}
