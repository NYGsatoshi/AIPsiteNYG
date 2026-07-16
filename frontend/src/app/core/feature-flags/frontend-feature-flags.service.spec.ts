import { TestBed } from '@angular/core/testing';

import { FrontendFeatureFlagsService } from './frontend-feature-flags.service';

describe('FrontendFeatureFlagsService', () => {
  it('defaults the v0.4 design system to enabled and supports rollback', () => {
    TestBed.configureTestingModule({});
    const flags = TestBed.inject(FrontendFeatureFlagsService);
    expect(flags.designSystemV04Enabled()).toBe(true);
    expect(document.documentElement.dataset['aipDesignSystem']).toBe('v04');
    flags.setForTesting({ 'frontend.designSystemV04': false });
    expect(flags.designSystemV04Enabled()).toBe(false);
    expect(document.documentElement.dataset['aipDesignSystem']).toBe('legacy');
  });
});