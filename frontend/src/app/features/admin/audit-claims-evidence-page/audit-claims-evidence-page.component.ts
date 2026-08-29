import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';

import { AuditClaimsEvidenceFacade } from './audit-claims-evidence.facade';
import { AuditClaimViewModel, AuditEvidenceSourceKind } from './audit-claims-evidence.types';

@Component({
  selector: 'app-audit-claims-evidence-page',
  standalone: true,
  templateUrl: './audit-claims-evidence-page.component.html',
  styleUrl: './audit-claims-evidence-page.component.scss',
})
export class AuditClaimsEvidencePageComponent {
  private readonly facade = inject(AuditClaimsEvidenceFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly routeVersionId = toSignal(
    this.route.queryParamMap.pipe(
      map((params) => params.get('artifactVersion')),
      distinctUntilChanged(),
    ),
    { initialValue: this.route.snapshot.queryParamMap.get('artifactVersion') },
  );

  readonly vm = this.facade.viewModel;
  readonly versionInput = signal(this.route.snapshot.queryParamMap.get('artifactVersion') ?? '');
  readonly inputError = signal<string | null>(null);
  readonly selectedClaimId = signal<string | null>(null);
  readonly selectedEvidenceId = signal<string | null>(null);

  readonly selectedClaim = computed(() => {
    const claimId = this.selectedClaimId();
    return this.vm().claims.find((claim) => claim.id === claimId) ?? null;
  });

  readonly selectedEvidence = computed(() => {
    const claim = this.selectedClaim();
    const evidenceId = this.selectedEvidenceId();
    if (!claim) {
      return null;
    }
    return claim.evidence.find((evidence) => evidence.id === evidenceId) ?? claim.evidence[0] ?? null;
  });

  constructor() {
    effect(() => {
      const versionId = this.routeVersionId();
      untracked(() => this.loadFromRoute(versionId));
    });

    effect(() => {
      const page = this.vm();
      if (page.status !== 'ready' || page.claims.length === 0) {
        return;
      }

      untracked(() => {
        const current = page.claims.find((claim) => claim.id === this.selectedClaimId());
        this.selectClaim(current ?? page.claims[0]);
      });
    });
  }

  updateVersionInput(value: string): void {
    this.versionInput.set(value);
    if (this.inputError()) {
      this.inputError.set(null);
    }
  }

  openVersion(): void {
    const versionId = this.versionInput().trim();
    if (!isGuid(versionId)) {
      this.inputError.set('Enter a valid artifact version ID.');
      return;
    }

    this.inputError.set(null);
    if (this.routeVersionId() === versionId) {
      this.facade.load(versionId);
      return;
    }

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { artifactVersion: versionId },
      queryParamsHandling: 'merge',
    });
  }

  selectClaim(claim: AuditClaimViewModel): void {
    this.selectedClaimId.set(claim.id);
    this.selectedEvidenceId.set(claim.evidence[0]?.id ?? null);
  }

  selectEvidence(evidenceId: string): void {
    if (this.selectedClaim()?.evidence.some((evidence) => evidence.id === evidenceId)) {
      this.selectedEvidenceId.set(evidenceId);
    }
  }

  sourceKindLabel(kind: AuditEvidenceSourceKind): string {
    switch (kind) {
      case 'WebSnapshot': return 'Web snapshot';
      case 'FileAttachment': return 'File attachment';
      case 'ArtifactVersion': return 'Artifact version';
      default: return 'Source';
    }
  }

  private loadFromRoute(versionId: string | null): void {
    this.selectedClaimId.set(null);
    this.selectedEvidenceId.set(null);
    this.versionInput.set(versionId ?? '');

    if (!versionId) {
      this.inputError.set(null);
      this.facade.clear();
      return;
    }

    if (!isGuid(versionId)) {
      this.inputError.set('Enter a valid artifact version ID.');
      this.facade.clear();
      return;
    }

    this.inputError.set(null);
    this.facade.load(versionId);
  }
}

function isGuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}
