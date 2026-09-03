import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { LucideFileText, LucideRefreshCw, LucideX } from '@lucide/angular';

interface Evidence {
  readonly id: string;
  readonly ordinal: number;
  readonly sourceKind: string;
  readonly sourceTitle: string | null;
  readonly passage: string;
  readonly location: string | null;
  readonly traceEventId: string | null;
}

interface Citation {
  readonly id: string;
  readonly ordinal: number;
  readonly claimId: string;
  readonly logicalClaimId: string;
  readonly evidence: readonly Evidence[];
}

interface Run {
  readonly kind: 'text' | 'citation';
  readonly text: string;
  readonly citation: Citation | null;
}

interface Section {
  readonly id: string;
  readonly logicalSectionId: string;
  readonly ordinal: number;
  readonly heading: string;
  readonly runs: readonly Run[];
}

interface Report {
  readonly projectId: string;
  readonly taskId: string | null;
  readonly artifactId: string;
  readonly artifactVersionId: string;
  readonly versionNumber: number;
  readonly canRefine: boolean;
  readonly title: string;
  readonly sections: readonly Section[];
}

type RefinementTargetKind = 'Section' | 'Claim';

interface RefinementScope {
  readonly origin: string;
  readonly projectScopeVersion: number;
  readonly taskOverrideVersion: number | null;
  readonly webEnabled: boolean;
  readonly projectFilesEnabled: boolean;
  readonly sourcePolicySchemaVersion: number;
  readonly researchPlanRevisionId: string | null;
  readonly researchPlanRevisionNo: number | null;
  readonly provider: string;
}

interface RefinementPreflight {
  readonly projectId: string;
  readonly taskItemId: string;
  readonly artifactId: string;
  readonly baseArtifactVersionId: string;
  readonly baseVersionNumber: number;
  readonly targetKind: RefinementTargetKind;
  readonly targetLogicalId: string;
  readonly targetLabel: string;
  readonly scope: RefinementScope;
  readonly canRefine: boolean;
  readonly restrictionCode: string | null;
  readonly changesApplyTo: string;
}

interface RefinementResult {
  readonly projectId: string;
  readonly taskItemId: string;
  readonly artifactId: string;
  readonly baseArtifactVersionId: string;
  readonly artifactVersionId: string;
  readonly versionNumber: number;
  readonly targetKind: RefinementTargetKind;
  readonly targetLogicalId: string;
  readonly refreshedClaimCount: number;
  readonly evidenceAdded: number;
}

const emptyCitation: Citation = {
  claimId: '',
  evidence: [],
  id: '',
  logicalClaimId: '',
  ordinal: Number.NaN
};
const emptyScope: RefinementScope = {
  origin: '',
  projectFilesEnabled: false,
  projectScopeVersion: Number.NaN,
  provider: '',
  researchPlanRevisionId: null,
  researchPlanRevisionNo: null,
  sourcePolicySchemaVersion: Number.NaN,
  taskOverrideVersion: null,
  webEnabled: false
};
const emptyPreflight: RefinementPreflight = {
  artifactId: '',
  baseArtifactVersionId: '',
  baseVersionNumber: Number.NaN,
  canRefine: false,
  changesApplyTo: '',
  projectId: '',
  restrictionCode: null,
  scope: emptyScope,
  targetKind: 'Claim',
  targetLabel: '',
  targetLogicalId: '',
  taskItemId: ''
};
const emptyReport: Report = {
  artifactId: '',
  artifactVersionId: '',
  canRefine: false,
  projectId: '',
  sections: [],
  taskId: null,
  title: '',
  versionNumber: Number.NaN
};

@Component({
  selector: 'app-report-reader-page',
  imports: [LucideFileText, LucideRefreshCw, LucideX],
  standalone: true,
  templateUrl: './report-reader-page.component.html',
  styleUrl: './report-reader-page.component.scss'
})
export class ReportReaderPageComponent {
  public confirmButtonText = 'Confirm and refine';
  public error = false;
  public feedback = '';
  public hasTaskContext = false;
  public inspectorOpen = false;
  public loading = true;
  public refinement = emptyPreflight;
  public refinementDialogOpen = false;
  public refinementError = '';
  public refinementLoading = false;
  public refinementSubmitting = false;
  public report = emptyReport;
  public researchPlanLabel = 'No active revision';
  public restrictionText = '';
  public scopeVersionLabel = '';
  public selected = emptyCitation;

  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private citationTrigger = globalThis.document.body;
  private refinementTrigger = globalThis.document.body;

  public constructor() {
    const [projectId, versionId, taskId] = [
      String(this.route.snapshot.paramMap.get('projectId')),
      String(this.route.snapshot.paramMap.get('artifactVersionId')),
      this.route.snapshot.paramMap.get('taskId')
    ];
    this.loadReport(projectId, versionId, taskId);
  }

  public select(citation: Readonly<Citation>, event: Readonly<Event>): void {
    if (event.currentTarget instanceof HTMLElement) {
      this.citationTrigger = event.currentTarget;
    }
    this.selected = citation;
    this.inspectorOpen = true;
    queueMicrotask(() => {
      globalThis.document.getElementById('evidence-inspector')?.focus();
    });
  }

  public close(): void {
    this.inspectorOpen = false;
    queueMicrotask(() => {
      this.citationTrigger.focus();
    });
  }

  public openSectionRefinement(logicalSectionId: string, event: Readonly<Event>): void {
    this.openRefinement('Section', logicalSectionId, event);
  }

  public openClaimRefinement(logicalClaimId: string, event: Readonly<Event>): void {
    this.openRefinement('Claim', logicalClaimId, event);
  }

  public closeRefinement(): void {
    this.refinementDialogOpen = false;
    this.refinementError = '';
    this.feedback = '';
    queueMicrotask(() => {
      this.refinementTrigger.focus();
    });
  }

  public updateFeedback(event: Readonly<Event>): void {
    if (event.target instanceof HTMLTextAreaElement) {
      this.feedback = event.target.value;
    }
  }

  public confirmRefinement(): void {
    if (this.refinementSubmitting || !this.refinement.canRefine) {
      return;
    }

    this.refinementSubmitting = true;
    this.confirmButtonText = 'Refining…';
    this.refinementError = '';
    this.http.post<RefinementResult>(
      `/api/projects/${this.refinement.projectId}/artifact-versions/${this.refinement.baseArtifactVersionId}/report/refinements`,
      {
        confirmedProjectScopeVersion: this.refinement.scope.projectScopeVersion,
        confirmedResearchPlanRevisionId: this.refinement.scope.researchPlanRevisionId,
        confirmedResearchPlanRevisionNo: this.refinement.scope.researchPlanRevisionNo,
        confirmedTaskOverrideVersion: this.refinement.scope.taskOverrideVersion,
        feedback: this.feedback.trim(),
        targetKind: this.refinement.targetKind,
        targetLogicalId: this.refinement.targetLogicalId
      }
    ).subscribe({
      error: () => {
        this.confirmButtonText = 'Confirm and refine';
        this.refinementError = 'The report could not be refined. Reload the preflight and confirm the current scope before retrying.';
        this.refinementSubmitting = false;
      },
      next: (result) => {
        this.feedback = '';
        this.refinementDialogOpen = false;
        this.refinementSubmitting = false;
        globalThis.location.assign(
          `/app/projects/${result.projectId}/tasks/${result.taskItemId}/reports/${result.artifactVersionId}`
        );
      }
    });
  }

  private loadReport(projectId: string, versionId: string, taskId: string | null): void {
    this.error = false;
    this.inspectorOpen = false;
    this.loading = true;
    this.refinementDialogOpen = false;
    let url = `/api/projects/${projectId}/artifact-versions/${versionId}/report`;
    if (this.route.snapshot.paramMap.has('taskId')) {
      url += `?taskId=${encodeURIComponent(String(taskId))}`;
    }

    this.http.get<Report>(url).subscribe({
      error: () => {
        this.error = true;
        this.loading = false;
      },
      next: (report) => {
        this.hasTaskContext = report.canRefine && report.taskId !== null;
        this.loading = false;
        this.report = report;
      }
    });
  }

  private openRefinement(
    kind: RefinementTargetKind,
    logicalId: string,
    event: Readonly<Event>
  ): void {
    if (this.refinementLoading) {
      return;
    }
    if (event.currentTarget instanceof HTMLElement) {
      this.refinementTrigger = event.currentTarget;
    }

    this.refinementError = '';
    this.refinementLoading = true;
    const query = new URLSearchParams({ targetKind: kind, targetLogicalId: logicalId });
    this.http.get<RefinementPreflight>(
      `/api/projects/${this.report.projectId}/artifact-versions/${this.report.artifactVersionId}/report/refinement-preflight?${query}`
    ).subscribe({
      error: () => {
        this.refinementError = 'Refinement details could not be loaded.';
        this.refinementLoading = false;
      },
      next: (preflight) => {
        this.feedback = '';
        this.refinement = preflight;
        this.refinementDialogOpen = true;
        this.refinementLoading = false;
        this.updatePreflightLabels(preflight);
        queueMicrotask(() => {
          globalThis.document.getElementById('report-refinement-dialog')?.focus();
        });
      }
    });
  }

  private updatePreflightLabels(preflight: Readonly<RefinementPreflight>): void {
    this.confirmButtonText = 'Confirm and refine';
    this.researchPlanLabel = 'No active revision';
    if (preflight.scope.researchPlanRevisionNo !== null) {
      this.researchPlanLabel = `Revision ${preflight.scope.researchPlanRevisionNo}`;
    }

    this.scopeVersionLabel = `Project ${preflight.scope.projectScopeVersion}`;
    if (preflight.scope.taskOverrideVersion !== null) {
      this.scopeVersionLabel += ` · Task override ${preflight.scope.taskOverrideVersion}`;
    }

    this.restrictionText = 'Localized refinement is not available for the current source scope.';
    if (preflight.restrictionCode === 'ReportRefinementProjectFilesRequired') {
      this.restrictionText = 'Localized refinement requires Project Files in the current source scope.';
    }
    if (preflight.restrictionCode === 'ReportRefinementUnsupportedSources') {
      this.restrictionText = 'This refinement provider cannot yet execute Web, Website, or Connected App sources. Adjust the Task source scope first.';
    }
  }
}
