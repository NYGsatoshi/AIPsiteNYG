import { Component, computed, inject, signal } from '@angular/core';
import { finalize } from 'rxjs';

import { AppEmptyStateComponent } from '../../../shared/empty-state/app-empty-state/app-empty-state.component';
import { AppInlineLoadingComponent } from '../../../shared/loading/app-inline-loading/app-inline-loading.component';
import { AppPermissionDeniedComponent } from '../../../shared/permission/app-permission-denied/app-permission-denied.component';
import { AccountFacade } from '../account.facade';
import { PasswordChangeResult, PasswordChangeSubmit } from '../account.types';
import { AccountProfilePanelComponent } from '../account-profile-panel/account-profile-panel.component';
import { AccountStatusPanelComponent } from '../account-status-panel/account-status-panel.component';
import { PasswordPanelComponent } from '../password-panel/password-panel.component';
import { SessionListComponent } from '../session-list/session-list.component';
import { TaskNotificationPreferencesComponent } from '../task-notification-preferences/task-notification-preferences.component';

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
    SessionListComponent,
    TaskNotificationPreferencesComponent
  ],
  templateUrl: './account-page.component.html',
  styleUrl: './account-page.component.scss'
})
export class AccountPageComponent {
  private readonly facade = inject(AccountFacade);

  readonly page = computed(() => this.facade.getPage());
  readonly passwordResult = signal<PasswordChangeResult | null>(null);
  readonly passwordPending = signal(false);
  readonly lastPasswordSubmit = signal<PasswordChangeSubmit | null>(null);

  changePassword(submit: PasswordChangeSubmit): void {
    this.lastPasswordSubmit.set(submit);
    this.passwordResult.set(null);
    this.passwordPending.set(true);
    this.facade
      .changePassword(submit)
      .pipe(finalize(() => this.passwordPending.set(false)))
      .subscribe((result) => this.passwordResult.set(result));
  }
}
