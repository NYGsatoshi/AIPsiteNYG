import { Component, Input } from '@angular/core';

import { AccountStatusViewModel } from '../account.types';

@Component({
  selector: 'app-account-status-panel',
  standalone: true,
  templateUrl: './account-status-panel.component.html',
  styleUrl: './account-status-panel.component.scss'
})
export class AccountStatusPanelComponent {
  @Input({ required: true }) status!: AccountStatusViewModel;
}
