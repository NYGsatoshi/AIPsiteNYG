import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { AipThemeToggleComponent } from './shared/theme/aip-theme-toggle/aip-theme-toggle.component';
import { RealtimeFacade } from './core/realtime/realtime.facade';
import { I18nService } from './core/i18n/i18n.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, AipThemeToggleComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.Eager
})
export class AppComponent {
  // Root ownership makes the transport lifecycle follow the authenticated app,
  // rather than any individual product feature or route.
  private readonly realtime = inject(RealtimeFacade);

  constructor() {
    // Initialize the persisted display-language preference before any route renders.
    inject(I18nService);
  }
}
