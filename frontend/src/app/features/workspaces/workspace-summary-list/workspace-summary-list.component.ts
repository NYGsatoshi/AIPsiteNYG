import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

import { WorkspaceCardComponent } from '../workspace-card/workspace-card.component';
import { WorkspaceCardViewModel } from '../workspaces.types';

@Component({
  selector: 'app-workspace-summary-list',
  standalone: true,
  imports: [WorkspaceCardComponent],
  templateUrl: './workspace-summary-list.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './workspace-summary-list.component.scss',
})
export class WorkspaceSummaryListComponent {
  @Input() workspaces: readonly WorkspaceCardViewModel[] = [];
}
