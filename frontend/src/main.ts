import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app';
import { AipThemeService } from './app/core/theme/aip-theme.service';
import { FrontendFeatureFlagsService } from './app/core/feature-flags/frontend-feature-flags.service';

bootstrapApplication(AppComponent, appConfig)
  .then((application) => {
    application.injector.get(AipThemeService);
    application.injector.get(FrontendFeatureFlagsService);
  })
  .catch((err) => console.error(err));
