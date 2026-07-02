import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-workspace-empty-state',
  standalone: true,
  templateUrl: './workspace-empty-state.component.html',
  styleUrl: './workspace-empty-state.component.scss'
})
export class WorkspaceEmptyStateComponent {
  @Input() title = '表示できるワークスペースがありません。';
  @Input() message = '参加できるワークスペースが追加されると、ここに表示されます。';
}
