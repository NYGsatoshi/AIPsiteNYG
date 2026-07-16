import { TestBed } from '@angular/core/testing';

import { FrontendFeatureFlagsService } from '../../../../core/feature-flags/frontend-feature-flags.service';
import { AIP_COMPLEX_ADAPTER_FACTORY, AipSyncfusionAdapterRegistry } from './syncfusion-adapter-registry.service';
import { AIP_SYNCFUSION_RUNTIME_CONFIGURATION } from './syncfusion-license-bootstrap.service';

describe('AipSyncfusionAdapterRegistry', () => {
  it('retains the fallback when flags are enabled but license confirmation is pending', async () => {
    const factory = { load: vi.fn(async () => 'syncfusion' as const) };
    TestBed.configureTestingModule({
      providers: [
        { provide: AIP_COMPLEX_ADAPTER_FACTORY, useValue: factory },
        { provide: AIP_SYNCFUSION_RUNTIME_CONFIGURATION, useValue: { licenseStatus: 'pending_vendor_confirmation' } }
      ]
    });
    const flags = TestBed.inject(FrontendFeatureFlagsService);
    flags.setForTesting({ 'frontend.syncfusionGrid': true, 'frontend.syncfusionUploader': true });
    const registry = TestBed.inject(AipSyncfusionAdapterRegistry);

    await expect(registry.resolve('data-grid')).resolves.toBe('fallback');
    await expect(registry.resolve('file-uploader')).resolves.toBe('fallback');
    await expect(registry.resolve('kanban')).resolves.toBe('fallback');
    expect(factory.load).not.toHaveBeenCalled();
  });
});
