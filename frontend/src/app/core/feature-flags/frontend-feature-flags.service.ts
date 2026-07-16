import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';

export interface FrontendRuntimeFlags {
  readonly 'frontend.designSystemV04'?: boolean;
  readonly 'frontend.syncfusionGrid'?: boolean;
  readonly 'frontend.syncfusionUploader'?: boolean;
}

declare global {
  interface Window {
    __AIP_FEATURE_FLAGS__?: FrontendRuntimeFlags;
  }
}

@Injectable({ providedIn: 'root' })
export class FrontendFeatureFlagsService {
  private readonly document = inject(DOCUMENT);
  private readonly values = signal<FrontendRuntimeFlags>(this.readRuntimeFlags());
  readonly designSystemV04Enabled = computed(() => this.values()['frontend.designSystemV04'] ?? true);
  // The canonical rollout amendment intentionally has no separate
  // `frontend.syncfusionAdapters` key. These flags switch only an adapter
  // implementation; they never grant a product capability.
  readonly syncfusionGridEnabled = computed(() => this.values()['frontend.syncfusionGrid'] ?? false);
  readonly syncfusionUploaderEnabled = computed(() => this.values()['frontend.syncfusionUploader'] ?? false);

  constructor() {
    this.applyDesignSystemMarker();
  }

  setForTesting(values: FrontendRuntimeFlags): void {
    this.values.set(values);
    this.applyDesignSystemMarker();
  }

  private readRuntimeFlags(): FrontendRuntimeFlags {
    return typeof window === 'undefined' ? {} : window.__AIP_FEATURE_FLAGS__ ?? {};
  }

  private applyDesignSystemMarker(): void {
    this.document.documentElement.dataset['aipDesignSystem'] = this.designSystemV04Enabled() ? 'v04' : 'legacy';
  }
}
