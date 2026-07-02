import { Component, Input } from '@angular/core';

import { AccountProfileViewModel } from '../account.types';

@Component({
  selector: 'app-account-profile-panel',
  standalone: true,
  templateUrl: './account-profile-panel.component.html',
  styleUrl: './account-profile-panel.component.scss'
})
export class AccountProfilePanelComponent {
  @Input({ required: true }) profile!: AccountProfileViewModel;
}
