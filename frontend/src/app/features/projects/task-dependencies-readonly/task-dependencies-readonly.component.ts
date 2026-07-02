import { Component, Input } from '@angular/core';

import { TaskDependencyViewModel } from '../projects.types';
import { TaskStatusBadgeComponent } from '../task-status-badge/task-status-badge.component';

@Component({
  selector: 'app-task-dependencies-readonly',
  standalone: true,
  imports: [TaskStatusBadgeComponent],
  template: `
    <section class="task-dependencies" data-testid="task-dependencies-readonly">
      <header>
        <h2>Dependencies</h2>
        <p data-testid="dependencies-display-only-note">Display only in P0. Dependency drag/drop and graph editing are not available.</p>
      </header>

      @if (dependencies.length > 0) {
        <ul>
          @for (dependency of dependencies; track dependency.id) {
            <li>
              <span>{{ dependency.title }}</span>
              <app-task-status-badge [status]="dependency.status" [label]="dependency.status" />
            </li>
          }
        </ul>
      } @else {
        <p class="task-dependencies__empty">No dependencies.</p>
      }
    </section>
  `,
  styles: [
    `
      .task-dependencies {
        display: grid;
        gap: 0.75rem;
      }

      .task-dependencies header {
        display: grid;
        gap: 0.25rem;
      }

      .task-dependencies h2 {
        margin: 0;
        font-size: 1rem;
      }

      .task-dependencies p {
        margin: 0;
        color: #536179;
      }

      .task-dependencies ul {
        display: grid;
        gap: 0.5rem;
        padding: 0;
        margin: 0;
        list-style: none;
      }

      .task-dependencies li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.75rem;
        border: 1px solid #d7deea;
        border-radius: 0.5rem;
        background: #fff;
      }

      .task-dependencies__empty {
        padding: 0.75rem;
        border: 1px dashed #c7d0df;
        border-radius: 0.5rem;
      }
    `
  ]
})
export class TaskDependenciesReadonlyComponent {
  @Input() dependencies: readonly TaskDependencyViewModel[] = [];
}
