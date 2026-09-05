import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import { AccountStatusViewModel } from '../account.types';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager
  selector: 'app-account-status-panel',
  standalone: true,
  templateUrl: './account-status-panel.component.html',
  styleUrl: './account-status-panel.component.scss',
})
export class AccountStatusPanelComponent {
  readonly i18n = inject(I18nService);
  @Input({ required: true }) status!: AccountStatusViewModel;
}
