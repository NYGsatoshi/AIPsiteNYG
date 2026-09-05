import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';

import { AppLocale, I18nService } from '../../../core/i18n/i18n.service';

@Component({
  selector: 'app-language-preferences',
  standalone: true,
  templateUrl: './language-preferences.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './language-preferences.component.scss',
})
export class LanguagePreferencesComponent {
  readonly i18n = inject(I18nService);
  readonly locales = this.i18n.localeOptions;
  readonly saved = signal(false);

  selectLocale(event: Event): void {
    const value = event.target instanceof HTMLSelectElement ? event.target.value : '';
    if (value === 'en' || value === 'ja') {
      this.i18n.setLocale(value as AppLocale);
      this.saved.set(true);
    }
  }
}
