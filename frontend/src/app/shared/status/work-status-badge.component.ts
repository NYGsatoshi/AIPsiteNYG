import { Component, Input } from '@angular/core';
import {
  LucideArchive,
  LucideCircleCheck,
  LucideCircleDashed,
  LucideCirclePause,
  LucideCirclePlay,
  LucideEye,
  LucideTriangleAlert
} from '@lucide/angular';

export type WorkStatusPresentation =
  | 'draft'
  | 'running'
  | 'ready'
  | 'needsReview'
  | 'atRisk'
  | 'completed'
  | 'paused'
  | 'archived';

@Component({
  selector: 'app-work-status-badge',
  standalone: true,
  imports: [
    LucideArchive,
    LucideCircleCheck,
    LucideCircleDashed,
    LucideCirclePause,
    LucideCirclePlay,
    LucideEye,
    LucideTriangleAlert
  ],
  template: `
    <span class="work-status-badge" [attr.data-status]="status">
      @switch (status) {
        @case ('draft') { <svg lucideCircleDashed aria-hidden="true"></svg> }
        @case ('running') { <svg lucideCirclePlay aria-hidden="true"></svg> }
        @case ('ready') { <svg lucideCircleCheck aria-hidden="true"></svg> }
        @case ('needsReview') { <svg lucideEye aria-hidden="true"></svg> }
        @case ('atRisk') { <svg lucideTriangleAlert aria-hidden="true"></svg> }
        @case ('completed') { <svg lucideCircleCheck aria-hidden="true"></svg> }
        @case ('paused') { <svg lucideCirclePause aria-hidden="true"></svg> }
        @case ('archived') { <svg lucideArchive aria-hidden="true"></svg> }
      }
      <span>{{ label }}</span>
    </span>
  `,
  styles: [
    `
      .work-status-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        min-height: 1.5rem;
        padding: 0.125rem 0.5rem;
        border: 1px solid #a8b3cf;
        border-radius: 999px;
        background: #f7f9fc;
        color: #172033;
        font-size: 0.8125rem;
        font-weight: 650;
        line-height: 1.25;
        white-space: nowrap;
      }

      .work-status-badge svg {
        width: 0.9rem;
        height: 0.9rem;
        flex: 0 0 auto;
      }

      .work-status-badge[data-status='running'],
      .work-status-badge[data-status='ready'] {
        border-color: #6f94c4;
        background: #f1f6fc;
      }

      .work-status-badge[data-status='needsReview'],
      .work-status-badge[data-status='atRisk'] {
        border-color: #c18b3d;
        background: #fff8eb;
      }

      .work-status-badge[data-status='completed'] {
        border-color: #6aa47a;
        background: #f0faf3;
      }

      .work-status-badge[data-status='paused'],
      .work-status-badge[data-status='archived'] {
        border-color: #9ca8bb;
        background: #f3f5f8;
      }
    `
  ]
})
export class WorkStatusBadgeComponent {
  @Input({ required: true }) status: WorkStatusPresentation = 'draft';
  @Input({ required: true }) label = '';
}
