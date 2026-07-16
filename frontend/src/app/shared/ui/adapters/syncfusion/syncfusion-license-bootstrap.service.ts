import { Inject, Injectable, InjectionToken } from '@angular/core';

export type AipSyncfusionLicenseStatus = 'pending_vendor_confirmation' | 'verified';
export type AipSyncfusionLicenseBootstrapState = 'pending_vendor_confirmation' | 'missing' | 'placeholder' | 'registered' | 'registration_failed';

export interface AipSyncfusionRuntimeConfiguration {
  readonly licenseKey?: string;
  readonly licenseStatus?: AipSyncfusionLicenseStatus;
}

export interface AipSyncfusionLicenseBootstrapResult {
  readonly canActivate: boolean;
  readonly state: AipSyncfusionLicenseBootstrapState;
}

export type AipSyncfusionLicenseRegistrar = (licenseKey: string) => void;

declare global {
  interface Window {
    __AIP_SYNCFUSION_RUNTIME__?: AipSyncfusionRuntimeConfiguration;
  }
}

export const AIP_SYNCFUSION_RUNTIME_CONFIGURATION = new InjectionToken<AipSyncfusionRuntimeConfiguration>(
  'AIP_SYNCFUSION_RUNTIME_CONFIGURATION',
  {
    factory: () => typeof window === 'undefined' ? {} : window.__AIP_SYNCFUSION_RUNTIME__ ?? {}
  }
);

const placeholderValues = new Set(['SYNCFUSION_LICENSE_KEY', 'PENDING_VENDOR_CONFIRMATION', '__SYNCFUSION_LICENSE_KEY__']);

@Injectable({ providedIn: 'root' })
export class AipSyncfusionLicenseBootstrapService {
  constructor(@Inject(AIP_SYNCFUSION_RUNTIME_CONFIGURATION) private readonly configuration: AipSyncfusionRuntimeConfiguration) {}

  bootstrap(registerLicense?: AipSyncfusionLicenseRegistrar): AipSyncfusionLicenseBootstrapResult {
    if (this.configuration.licenseStatus !== 'verified') {
      return { canActivate: false, state: 'pending_vendor_confirmation' };
    }

    const licenseKey = this.configuration.licenseKey?.trim();
    if (!licenseKey) {
      return { canActivate: false, state: 'missing' };
    }

    if (placeholderValues.has(licenseKey)) {
      return { canActivate: false, state: 'placeholder' };
    }

    if (!registerLicense) {
      return { canActivate: false, state: 'missing' };
    }

    try {
      registerLicense(licenseKey);
      return { canActivate: true, state: 'registered' };
    } catch {
      return { canActivate: false, state: 'registration_failed' };
    }
  }
}
