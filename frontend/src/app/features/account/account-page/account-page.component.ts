import { Component, computed, inject, signal } from '@angular/core';

import { AppEmptyStateComponent } from '../../../shared/empty-state/app-empty-state/app-empty-state.component';
import { AppInlineLoadingComponent } from '../../../shared/loading/app-inline-loading/app-inline-loading.component';
import { AppPermissionDeniedComponent } from '../../../shared/permission/app-permission-denied/app-permission-denied.component';
import { AccountFacade } from '../account.facade';
import { PasswordChangeResult, PasswordChangeSubmit } from '../account.types';
import { AccountProfilePanelComponent } from '../account-profile-panel/account-profile-panel.component';
import { AccountStatusPanelComponent } from '../account-status-panel/account-status-panel.component';
import { PasswordPanelComponent } from '../password-panel/password-panel.component';
import { SessionListComponent } from '../session-list/session-list.component';

@Component({
  selector: 'app-account-page',
  standalone: true,
  imports: [
    AccountProfilePanelComponent,
    AccountStatusPanelComponent,
    AppEmptyStateComponent,
    AppInlineLoadingComponent,
    AppPermissionDeniedComponent,
    PasswordPanelComponent,
    SessionListComponent
  ],
  templateUrl: './account-page.component.html',
  styleUrl: './account-page.component.scss'
})
export class AccountPageComponent {
  private readonly facade = inject(AccountFacade);

  readonly page = computed(() => this.facade.getPage());
  readonly passwordResult = signal<PasswordChangeResult | null>(null);
  readonly lastPasswordSubmit = signal<PasswordChangeSubmit | null>(null);

  changePassword(submit: PasswordChangeSubmit): void {
    this.lastPasswordSubmit.set(submit);
    this.passwordResult.set(this.facade.changePassword(submit));
  }
}
