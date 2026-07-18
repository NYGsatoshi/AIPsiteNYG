import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

import { registerLicense } from '@syncfusion/ej2-base';

registerLicense('Ngo9BigBOggjHTQxAR8/V1JAaF5cX2pCd1p/TH5YfUNzdUVEY1ZUTXxaS1ZhSXxVdkJiUX9ccX1URWJVWUF9XEY=');

bootstrapApplication(AppComponent, appConfig)
  .catch((error) => console.error(error));

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
