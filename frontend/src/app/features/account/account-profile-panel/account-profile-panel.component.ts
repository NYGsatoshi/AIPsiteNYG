import { Component, inject, Input } from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import { AccountProfileViewModel } from '../account.types';

@Component({
  selector: 'app-account-profile-panel',
  standalone: true,
  templateUrl: './account-profile-panel.component.html',
  styleUrl: './account-profile-panel.component.scss'
})
export class AccountProfilePanelComponent {
  readonly i18n = inject(I18nService);
  @Input({ required: true }) profile!: AccountProfileViewModel;
}
