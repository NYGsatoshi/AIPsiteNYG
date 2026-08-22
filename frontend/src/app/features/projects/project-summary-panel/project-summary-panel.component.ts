import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  WorkStatusBadgeComponent,
  WorkStatusPresentation
} from '../../../shared/status/work-status-badge.component';
import { ProjectStatus, ProjectSummaryViewModel } from '../projects.types';

@Component({
  selector: 'app-project-summary-panel',
  standalone: true,
  imports: [RouterLink, WorkStatusBadgeComponent],
  template: `
    <section class="project-summary-panel" data-testid="project-summary-panel">
      @for (project of projects; track project.id) {
        <article class="project-summary-panel__item" data-testid="project-summary-card">
          <div class="project-summary-panel__primary">
            <a [routerLink]="['/projects', project.id]" [attr.aria-label]="'Open ' + project.name">
              <h2>{{ project.name }}</h2>
            </a>
            <app-work-status-badge
              [status]="statusPresentation(project.status)"
              [label]="statusLabel(project.status)"
            />
          </div>

          <details class="project-summary-panel__secondary">
            <summary>Project details</summary>
            <dl>
              <div>
                <dt>Start</dt>
                <dd>{{ project.startDate || 'Not set' }}</dd>
              </div>
              <div>
                <dt>Due</dt>
                <dd>{{ project.dueDate || 'Not set' }}</dd>
              </div>
              <div>
                <dt>Tasks</dt>
                <dd>{{ project.taskCounts.done }}/{{ project.taskCounts.total }} done</dd>
              </div>
            </dl>
          </details>
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
        min-width: 0;
        padding: 1rem;
        border: 1px solid #d7deea;
        border-radius: 0.5rem;
        background: #fff;
      }

      .project-summary-panel__primary {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.75rem;
      }

      .project-summary-panel h2,
      .project-summary-panel dl {
        margin: 0;
      }

      .project-summary-panel h2 {
        font-size: 1.05rem;
        overflow-wrap: anywhere;
      }

      .project-summary-panel a {
        min-width: 0;
        color: inherit;
        text-decoration: none;
      }

      .project-summary-panel a:hover,
      .project-summary-panel a:focus-visible {
        text-decoration: underline;
      }

      .project-summary-panel__secondary {
        border-top: 1px solid #e6ebf2;
        padding-top: 0.625rem;
        color: #536179;
        font-size: 0.875rem;
      }

      .project-summary-panel__secondary summary {
        width: fit-content;
        cursor: pointer;
        font-weight: 600;
      }

      .project-summary-panel__secondary dl {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.5rem;
        margin-top: 0.625rem;
      }

      .project-summary-panel__secondary dt {
        font-size: 0.75rem;
      }

      .project-summary-panel__secondary dd {
        margin: 0.125rem 0 0;
        color: #172033;
        font-weight: 650;
      }

      @media (max-width: 36rem) {
        .project-summary-panel__primary {
          align-items: flex-start;
          flex-direction: column;
        }

        .project-summary-panel__secondary dl {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class ProjectSummaryPanelComponent {
  @Input() projects: readonly ProjectSummaryViewModel[] = [];

  readonly statusPresentation = projectStatusPresentation;
  readonly statusLabel = projectStatusDisplayLabel;
}

export function projectStatusPresentation(status: ProjectStatus): WorkStatusPresentation {
  return (
    {
      planning: 'draft',
      active: 'running',
      review: 'needsReview',
      atRisk: 'atRisk',
      complete: 'completed',
      suspended: 'paused',
      archived: 'archived'
    } satisfies Record<ProjectStatus, WorkStatusPresentation>
  )[status];
}

export function projectStatusDisplayLabel(status: ProjectStatus): string {
  return (
    {
      planning: 'Draft',
      active: 'Running',
      review: 'Needs review',
      atRisk: 'At risk',
      complete: 'Completed',
      suspended: 'Paused',
      archived: 'Archived'
    } satisfies Record<ProjectStatus, string>
  )[status];
}
