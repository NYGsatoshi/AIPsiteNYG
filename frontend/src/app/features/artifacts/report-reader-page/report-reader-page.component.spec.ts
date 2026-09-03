import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { ReportReaderPageComponent } from './report-reader-page.component';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const TASK_ID = '22222222-2222-2222-2222-222222222222';
const VERSION_ID = '33333333-3333-3333-3333-333333333333';
const CLAIM_ID = '44444444-4444-4444-4444-444444444444';
const LOGICAL_CLAIM_ID = '55555555-5555-5555-5555-555555555555';
const SECTION_ID = '66666666-6666-6666-6666-666666666666';
const LOGICAL_SECTION_ID = '77777777-7777-7777-7777-777777777777';
const PLAN_REVISION_ID = '88888888-8888-8888-8888-888888888888';

function reportResponse() {
  return {
    projectId: PROJECT_ID,
    taskId: TASK_ID,
    artifactId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    artifactVersionId: VERSION_ID,
    versionNumber: 4,
    canRefine: true,
    title: 'Evidence report',
    sections: [{
      id: SECTION_ID,
      logicalSectionId: LOGICAL_SECTION_ID,
      ordinal: 1,
      heading: 'Findings',
      runs: [{
        kind: 'citation',
        text: 'Supported claim',
        citation: {
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          ordinal: 1,
          claimId: CLAIM_ID,
          logicalClaimId: LOGICAL_CLAIM_ID,
          evidence: []
        }
      }]
    }]
  };
}

function preflightResponse() {
  return {
    projectId: PROJECT_ID,
    taskItemId: TASK_ID,
    artifactId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    baseArtifactVersionId: VERSION_ID,
    baseVersionNumber: 4,
    targetKind: 'Claim',
    targetLogicalId: LOGICAL_CLAIM_ID,
    targetLabel: 'Supported claim',
    scope: {
      origin: 'TaskOverride',
      projectScopeVersion: 8,
      taskOverrideVersion: 3,
      webEnabled: false,
      projectFilesEnabled: true,
      sourcePolicySchemaVersion: 2,
      researchPlanRevisionId: PLAN_REVISION_ID,
      researchPlanRevisionNo: 5,
      provider: 'LocalizedProjectFilesEvidenceRefineV1'
    },
    canRefine: true,
    restrictionCode: null,
    changesApplyTo: 'Only evidence for the selected Claim is refreshed.'
  };
}

function taskScopeResponse() {
  return {
    effectivePolicy: {
      webEnabled: false,
      projectFilesEnabled: true,
      policyV2: {
        schemaVersion: 2,
        web: 'Exclude',
        webSite: 'Exclude',
        projectFile: 'Allow',
        connectedApp: 'Exclude',
        items: [
          { kind: 'ProjectFile', sourceId: 'file:11111111111111111111111111111111', state: 'Prioritize' },
          { kind: 'ProjectFile', sourceId: 'file:22222222222222222222222222222222', state: 'Exclude' }
        ]
      }
    },
    origin: 'TaskOverride',
    projectDefaultVersion: 8,
    taskOverrideVersion: 3,
    taskOverridePolicy: null,
    canManage: true,
    latestRun: null,
    changesApplyTo: 'nextRun',
    sourceInventory: [
      { kind: 'ProjectFile', sourceId: 'file:11111111111111111111111111111111', label: 'preferred.md' },
      { kind: 'ProjectFile', sourceId: 'file:22222222222222222222222222222222', label: 'excluded.md' }
    ]
  };
}

describe('ReportReaderPageComponent localized refinement', () => {
  let fixture: ComponentFixture<ReportReaderPageComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReportReaderPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({
                projectId: PROJECT_ID,
                taskId: TASK_ID,
                artifactVersionId: VERSION_ID
              })
            }
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ReportReaderPageComponent);
    http = TestBed.inject(HttpTestingController);
    http.expectOne(
      `/api/projects/${PROJECT_ID}/artifact-versions/${VERSION_ID}/report?taskId=${TASK_ID}`
    ).flush(reportResponse());
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('confirms the current itemized source scope before starting a Claim refinement', () => {
    const citationButton = fixture.nativeElement.querySelector('.citation') as HTMLButtonElement;
    citationButton.click();
    fixture.detectChanges();
    const claimButton = fixture.nativeElement.querySelector('.claim-refine') as HTMLButtonElement;
    claimButton.click();

    http.expectOne((request) =>
      request.url === `/api/projects/${PROJECT_ID}/artifact-versions/${VERSION_ID}/report/refinement-preflight` &&
      request.params.get('targetKind') === 'Claim' &&
      request.params.get('targetLogicalId') === LOGICAL_CLAIM_ID
    ).flush(preflightResponse());
    http.expectOne(`/api/tasks/${TASK_ID}/execution-scope`).flush(taskScopeResponse());
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('#report-refinement-dialog') as HTMLElement;
    expect(dialog.hidden).toBeFalse();
    expect(dialog.textContent).toContain('Supported claim');
    expect(dialog.textContent).toContain('Revision 5');
    expect(dialog.textContent).toContain('Project 8 · Task override 3');
    expect(dialog.textContent).toContain('Project Files default');
    expect(dialog.textContent).toContain('preferred.md');
    expect(dialog.textContent).toContain('Prioritize');
    expect(dialog.textContent).toContain('excluded.md');
    expect(dialog.textContent).toContain('Exclude');

    fixture.componentInstance.feedback = 'Use the preferred file.';
    fixture.componentInstance.confirmRefinement();
    const request = http.expectOne(
      `/api/projects/${PROJECT_ID}/artifact-versions/${VERSION_ID}/report/refinements`
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      confirmedProjectScopeVersion: 8,
      confirmedResearchPlanRevisionId: PLAN_REVISION_ID,
      confirmedResearchPlanRevisionNo: 5,
      confirmedTaskOverrideVersion: 3,
      feedback: 'Use the preferred file.',
      targetKind: 'Claim',
      targetLogicalId: LOGICAL_CLAIM_ID
    });
    request.flush(
      { code: 'ReportRefinementScopeChanged' },
      { status: 409, statusText: 'Conflict' }
    );
  });

  it('fails closed when the source scope changes between preflight and confirmation', () => {
    const sectionButton = fixture.nativeElement.querySelector('.refine-action') as HTMLButtonElement;
    sectionButton.click();

    const preflight = preflightResponse();
    preflight.targetKind = 'Section';
    preflight.targetLogicalId = LOGICAL_SECTION_ID;
    http.expectOne((request) => request.url.includes('/report/refinement-preflight')).flush(preflight);
    const scope = taskScopeResponse();
    scope.projectDefaultVersion = 9;
    http.expectOne(`/api/tasks/${TASK_ID}/execution-scope`).flush(scope);
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('#report-refinement-dialog') as HTMLElement;
    expect(dialog.hidden).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('The source scope changed during confirmation.');
    http.expectNone(`/api/projects/${PROJECT_ID}/artifact-versions/${VERSION_ID}/report/refinements`);
  });
});
