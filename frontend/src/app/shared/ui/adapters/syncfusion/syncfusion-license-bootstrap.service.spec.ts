import { TestBed } from '@angular/core/testing';

import {
  AIP_SYNCFUSION_RUNTIME_CONFIGURATION,
  AipSyncfusionLicenseBootstrapService
} from './syncfusion-license-bootstrap.service';

describe('AipSyncfusionLicenseBootstrapService', () => {
  function configure(configuration: object): AipSyncfusionLicenseBootstrapService {
    TestBed.configureTestingModule({ providers: [{ provide: AIP_SYNCFUSION_RUNTIME_CONFIGURATION, useValue: configuration }] });
    return TestBed.inject(AipSyncfusionLicenseBootstrapService);
  }

  it('fails closed while vendor confirmation is pending without exposing a key', () => {
    const register = vi.fn();
    const result = configure({ licenseStatus: 'pending_vendor_confirmation', licenseKey: 'not-a-real-license-key' }).bootstrap(register);

    expect(result).toEqual({ canActivate: false, state: 'pending_vendor_confirmation' });
    expect(JSON.stringify(result)).not.toContain('not-a-real-license-key');
    expect(register).not.toHaveBeenCalled();
  });

  it('rejects missing and placeholder configuration without invoking the registrar', () => {
    const register = vi.fn();
    expect(configure({ licenseStatus: 'verified' }).bootstrap(register)).toEqual({ canActivate: false, state: 'missing' });

    TestBed.resetTestingModule();
    expect(configure({ licenseStatus: 'verified', licenseKey: 'SYNCFUSION_LICENSE_KEY' }).bootstrap(register)).toEqual({
      canActivate: false,
      state: 'placeholder'
    });
    expect(register).not.toHaveBeenCalled();
  });

  it('uses the one registrar entry point only after a verified non-placeholder configuration', () => {
    const register = vi.fn();
    const result = configure({ licenseStatus: 'verified', licenseKey: 'not-a-real-license-key' }).bootstrap(register);

    expect(result).toEqual({ canActivate: true, state: 'registered' });
    expect(register).toHaveBeenCalledTimes(1);
  });
});
