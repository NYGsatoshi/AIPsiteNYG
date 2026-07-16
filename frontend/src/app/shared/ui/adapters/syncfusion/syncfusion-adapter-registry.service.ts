import { Injectable, InjectionToken, inject } from '@angular/core';

import { FrontendFeatureFlagsService } from '../../../../core/feature-flags/frontend-feature-flags.service';
import { AipComplexAdapterName } from '../../contracts/aip-complex-adapter.contracts';
import { AipSyncfusionLicenseBootstrapService } from './syncfusion-license-bootstrap.service';

export type AipAdapterImplementation = 'fallback' | 'syncfusion';

export interface AipComplexAdapterFactory {
  load(adapter: AipComplexAdapterName): Promise<AipAdapterImplementation>;
}

const fallbackFactory: AipComplexAdapterFactory = {
  load: async () => 'fallback'
};

// A future approved vendor implementation replaces this token from the adapter
// boundary. Feature code continues to consume AIPsite contracts only.
export const AIP_COMPLEX_ADAPTER_FACTORY = new InjectionToken<AipComplexAdapterFactory>(
  'AIP_COMPLEX_ADAPTER_FACTORY',
  { factory: () => fallbackFactory }
);

@Injectable({ providedIn: 'root' })
export class AipSyncfusionAdapterRegistry {
  private readonly factory = inject(AIP_COMPLEX_ADAPTER_FACTORY);
  private readonly flags = inject(FrontendFeatureFlagsService);
  private readonly license = inject(AipSyncfusionLicenseBootstrapService);

  async resolve(adapter: AipComplexAdapterName): Promise<AipAdapterImplementation> {
    if (!this.isRolledOut(adapter) || !this.license.bootstrap().canActivate) {
      return 'fallback';
    }

    return this.factory.load(adapter);
  }

  private isRolledOut(adapter: AipComplexAdapterName): boolean {
    switch (adapter) {
      case 'data-grid':
        return this.flags.syncfusionGridEnabled();
      case 'file-uploader':
        return this.flags.syncfusionUploaderEnabled();
      default:
        return false;
    }
  }
}
