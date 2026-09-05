import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';

import { WorkspaceActionCapability } from '../workspaces.types';

@Component({
  selector: 'app-workspace-quick-actions',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './workspace-quick-actions.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './workspace-quick-actions.component.scss',
})
export class WorkspaceQuickActionsComponent {
  @Input({ required: true }) workspaceId = '';
  @Input() capabilities: readonly WorkspaceActionCapability[] = [];

  hasCapability(capability: WorkspaceActionCapability): boolean {
    return this.capabilities.includes(capability);
  }
}
