import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ProjectSummaryViewModel } from '../projects.types';
import { ProjectSummaryPanelComponent, projectStatusPresentation } from './project-summary-panel.component';

const project = (status: ProjectSummaryViewModel['status']): ProjectSummaryViewModel => ({
  id: `project-${status}`,
  name: `Project ${status}`,
  status,
  statusLabel: 'legacy status label',
  startDate: '2026-08-01',
  dueDate: '2026-08-31',
  group: 'Group not shown by API',
  taskCounts: { total: 5, done: 2, blocked: 1 },
  canCreateTask: false
});

describe('ProjectSummaryPanelComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('maps every Project lifecycle state to the shared work-status vocabulary', () => {
    expect(projectStatusPresentation('planning')).toBe('draft');
    expect(projectStatusPresentation('active')).toBe('running');
    expect(projectStatusPresentation('review')).toBe('needsReview');
    expect(projectStatusPresentation('atRisk')).toBe('needsAttention');
    expect(projectStatusPresentation('complete')).toBe('completed');
    expect(projectStatusPresentation('suspended')).toBe('paused');
    expect(projectStatusPresentation('archived')).toBe('archived');
  });

  it('renders icon plus normalized text and keeps secondary metrics collapsed by default', async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectSummaryPanelComponent],
      providers: [provideRouter([])]
    }).compileComponents();

    const fixture = TestBed.createComponent(ProjectSummaryPanelComponent);
    fixture.componentInstance.projects = [project('active')];
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const badge = root.querySelector<HTMLElement>('app-work-status-badge .work-status');
    const details = root.querySelector<HTMLDetailsElement>('.project-summary-panel__secondary');

    expect(badge?.textContent).toContain('Running');
    expect(badge?.getAttribute('data-work-status')).toBe('running');
    expect(badge?.querySelector('svg')).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(root.textContent).not.toContain('legacy status label');
    expect(root.textContent).not.toContain('Group not shown by API');
  });
});
