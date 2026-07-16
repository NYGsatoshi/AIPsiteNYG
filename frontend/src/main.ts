import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app';
import { AipThemeService } from './app/core/theme/aip-theme.service';
import { FrontendFeatureFlagsService } from './app/core/feature-flags/frontend-feature-flags.service';
import { AipSyncfusionLicenseBootstrapService } from './app/shared/ui/adapters/syncfusion/syncfusion-license-bootstrap.service';

bootstrapApplication(AppComponent, appConfig)
  .then((application) => {
    application.injector.get(AipThemeService);
    application.injector.get(FrontendFeatureFlagsService);
    // The default pending configuration is deliberately inert. A future
    // approved vendor adapter supplies the only registrar callback.
    application.injector.get(AipSyncfusionLicenseBootstrapService).bootstrap();
  })
  .catch((err) => console.error(err));
