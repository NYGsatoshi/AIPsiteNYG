import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ProjectSummaryViewModel } from '../projects.types';

@Component({
  selector: 'app-project-summary-panel',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="project-summary-panel" data-testid="project-summary-panel">
      @for (project of projects; track project.id) {
        <article class="project-summary-panel__item" data-testid="project-summary-card">
          <a [routerLink]="['/projects', project.id]" [attr.aria-label]="'Open ' + project.name">
            <h2>{{ project.name }}</h2>
            <p>{{ project.group }}</p>
          </a>
          <dl>
            <div>
              <dt>Status</dt>
              <dd>{{ project.statusLabel }}</dd>
            </div>
            <div>
              <dt>Start</dt>
              <dd>{{ project.startDate }}</dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd>{{ project.dueDate }}</dd>
            </div>
            <div>
              <dt>Tasks</dt>
              <dd>{{ project.taskCounts.done }}/{{ project.taskCounts.total }} done</dd>
            </div>
          </dl>
        </article>
      }
    </section>
  `,
  styles: [
    `
      .project-summary-panel {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
        gap: 0.75rem;
      }

      .project-summary-panel__item {
        display: grid;
        gap: 0.75rem;
        padding: 1rem;
        border: 1px solid #d7deea;
        border-radius: 0.5rem;
        background: #fff;
      }

      .project-summary-panel h2,
      .project-summary-panel p,
      .project-summary-panel dl {
        margin: 0;
      }

      .project-summary-panel h2 {
        font-size: 1.05rem;
      }

      .project-summary-panel a { color: inherit; text-decoration: none; }

      .project-summary-panel p,
      .project-summary-panel dt {
        color: #536179;
      }

      .project-summary-panel dl {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 0.5rem;
      }

      .project-summary-panel dt {
        font-size: 0.75rem;
      }

      .project-summary-panel dd {
        margin: 0;
        font-weight: 700;
      }
    `
  ]
})
export class ProjectSummaryPanelComponent {
  @Input() projects: readonly ProjectSummaryViewModel[] = [];
}
