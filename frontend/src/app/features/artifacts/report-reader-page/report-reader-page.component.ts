import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, inject, signal, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { LucideFileText, LucideRefreshCw, LucideX } from '@lucide/angular';

type Evidence = {
  id: string;
  ordinal: number;
  sourceKind: string;
  sourceTitle: string | null;
  passage: string;
  location: string | null;
  traceEventId: string | null;
};
type Citation = {
  id: string;
  ordinal: number;
  claimId: string;
  logicalClaimId: string;
  evidence: Evidence[];
};
type Run = { kind: 'text' | 'citation'; text: string; citation: Citation | null };
type Section = {
  id: string;
  logicalSectionId: string;
  ordinal: number;
  heading: string;
  runs: Run[];
};
type Report = {
  projectId: string;
  taskId: string | null;
  artifactId: string;
  artifactVersionId: string;
  versionNumber: number;
  title: string;
  sections: Section[];
};
type RefinementTargetKind = 'Section' | 'Claim';
type RefinementScope = {
  origin: string;
  projectScopeVersion: number;
  taskOverrideVersion: number | null;
  webEnabled: boolean;
  projectFilesEnabled: boolean;
  sourcePolicySchemaVersion: number;
  researchPlanRevisionId: string | null;
  researchPlanRevisionNo: number | null;
  provider: string;
};
type RefinementPreflight = {
  projectId: string;
  taskItemId: string;
  artifactId: string;
  baseArtifactVersionId: string;
  baseVersionNumber: number;
  targetKind: RefinementTargetKind;
  targetLogicalId: string;
  targetLabel: string;
  scope: RefinementScope;
  canRefine: boolean;
  restrictionCode: string | null;
  changesApplyTo: string;
};
type RefinementResult = {
  projectId: string;
  taskItemId: string;
  artifactId: string;
  baseArtifactVersionId: string;
  artifactVersionId: string;
  versionNumber: number;
  targetKind: RefinementTargetKind;
  targetLogicalId: string;
  refreshedClaimCount: number;
  evidenceAdded: number;
};

@Component({
  selector: 'app-report-reader-page',
  standalone: true,
  imports: [LucideX, LucideFileText, LucideRefreshCw],
  templateUrl: './report-reader-page.component.html',
  styleUrl: './report-reader-page.component.scss'
})
export class ReportReaderPageComponent {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private citationTrigger: HTMLElement | null = null;
  private refinementTrigger: HTMLElement | null = null;

  readonly loading = signal(true);
  readonly error = signal(false);
  readonly report = signal<Report | null>(null);
  readonly selected = signal<Citation | null>(null);
  readonly refinement = signal<RefinementPreflight | null>(null);
  readonly refinementLoading = signal(false);
  readonly refinementSubmitting = signal(false);
  readonly refinementError = signal<string | null>(null);
  readonly feedback = signal('');

  @ViewChild('inspector') inspector?: ElementRef<HTMLElement>;
  @ViewChild('refinementDialog') refinementDialog?: ElementRef<HTMLElement>;

  constructor() {
    this.route.paramMap.subscribe((params) => {
      const projectId = params.get('projectId');
      const versionId = params.get('artifactVersionId');
      const taskId = params.get('taskId');
      if (!projectId || !versionId) {
        this.loading.set(false);
        this.error.set(true);
        return;
      }
      this.loadReport(projectId, versionId, taskId);
    });
  }

  select(citation: Citation, event: Event): void {
    this.citationTrigger = event.currentTarget as HTMLElement;
    this.selected.set(citation);
    queueMicrotask(() => this.inspector?.nativeElement.focus());
  }

  close(): void {
    this.selected.set(null);
    queueMicrotask(() => this.citationTrigger?.focus());
  }

  openSectionRefinement(section: Section, event: Event): void {
    this.openRefinement('Section', section.logicalSectionId, event);
  }

  openClaimRefinement(citation: Citation, event: Event): void {
    this.openRefinement('Claim', citation.logicalClaimId, event);
  }

  closeRefinement(): void {
    this.refinement.set(null);
    this.refinementError.set(null);
    this.feedback.set('');
    queueMicrotask(() => this.refinementTrigger?.focus());
  }

  updateFeedback(value: string): void {
    this.feedback.set(value.slice(0, 1000));
  }

  confirmRefinement(): void {
    const preflight = this.refinement();
    if (!preflight || !preflight.canRefine || this.refinementSubmitting()) return;

    this.refinementSubmitting.set(true);
    this.refinementError.set(null);
    this.http.post<RefinementResult>(
      `/api/projects/${preflight.projectId}/artifact-versions/${preflight.baseArtifactVersionId}/report/refinements`,
      {
        targetKind: preflight.targetKind,
        targetLogicalId: preflight.targetLogicalId,
        feedback: this.feedback().trim() || null,
        confirmedProjectScopeVersion: preflight.scope.projectScopeVersion,
        confirmedTaskOverrideVersion: preflight.scope.taskOverrideVersion,
        confirmedResearchPlanRevisionId: preflight.scope.researchPlanRevisionId,
        confirmedResearchPlanRevisionNo: preflight.scope.researchPlanRevisionNo
      }
    ).subscribe({
      next: (result) => {
        this.refinementSubmitting.set(false);
        this.refinement.set(null);
        this.feedback.set('');
        const url = result.taskItemId
          ? `/app/projects/${result.projectId}/tasks/${result.taskItemId}/reports/${result.artifactVersionId}`
          : `/app/projects/${result.projectId}/reports/${result.artifactVersionId}`;
        void this.router.navigateByUrl(url);
      },
      error: () => {
        this.refinementSubmitting.set(false);
        this.refinementError.set('The report could not be refined. Reload the preflight and confirm the current scope before retrying.');
      }
    });
  }

  restrictionMessage(code: string | null): string {
    switch (code) {
      case 'ReportRefinementProjectFilesRequired':
        return 'Localized refinement requires Project Files in the current source scope.';
      case 'ReportRefinementUnsupportedSources':
        return 'This refinement provider cannot yet execute Web, Website, or Connected App sources. Adjust the Task source scope first.';
      default:
        return 'Localized refinement is not available for the current source scope.';
    }
  }

  private loadReport(projectId: string, versionId: string, taskId: string | null): void {
    this.loading.set(true);
    this.error.set(false);
    this.report.set(null);
    this.selected.set(null);
    this.refinement.set(null);
    const suffix = taskId ? `?taskId=${encodeURIComponent(taskId)}` : '';
    this.http.get<Report>(`/api/projects/${projectId}/artifact-versions/${versionId}/report${suffix}`).subscribe({
      next: (report) => {
        this.report.set(report);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      }
    });
  }

  private openRefinement(kind: RefinementTargetKind, logicalId: string, event: Event): void {
    const report = this.report();
    if (!report || this.refinementLoading()) return;

    this.refinementTrigger = event.currentTarget as HTMLElement;
    this.refinementLoading.set(true);
    this.refinementError.set(null);
    const query = new URLSearchParams({ targetKind: kind, targetLogicalId: logicalId });
    this.http.get<RefinementPreflight>(
      `/api/projects/${report.projectId}/artifact-versions/${report.artifactVersionId}/report/refinement-preflight?${query}`
    ).subscribe({
      next: (preflight) => {
        this.refinementLoading.set(false);
        this.feedback.set('');
        this.refinement.set(preflight);
        queueMicrotask(() => this.refinementDialog?.nativeElement.focus());
      },
      error: () => {
        this.refinementLoading.set(false);
        this.refinementError.set('Refinement details could not be loaded.');
      }
    });
  }
}
