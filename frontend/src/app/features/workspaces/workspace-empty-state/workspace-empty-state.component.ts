import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-workspace-empty-state',
  standalone: true,
  templateUrl: './workspace-empty-state.component.html',
  styleUrl: './workspace-empty-state.component.scss'
})
export class WorkspaceEmptyStateComponent {
  @Input() title = '表示できるWorkspaceがありません';
  @Input() message = 'Workspaceの作成または招待が完了すると、ここに表示されます。';
  @Input() actionLabel: string | null = null;
  @Output() readonly action = new EventEmitter<void>();
}
