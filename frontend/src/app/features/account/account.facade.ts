import { inject, Injectable, InjectionToken } from '@angular/core';

import { ACCOUNT_MOCK_SCENARIOS, buildAccountStatus } from './account.mock';
import {
  AccountMockScenario,
  AccountPageViewModel,
  AccountSessionViewModel,
  PasswordChangeResult,
  PasswordChangeSubmit
} from './account.types';

export const AIP_ACCOUNT_MOCK = new InjectionToken<AccountMockScenario>('AIP_ACCOUNT_MOCK');

@Injectable({
  providedIn: 'root'
})
export class AccountFacade {
  private readonly scenario: AccountMockScenario =
    inject(AIP_ACCOUNT_MOCK, { optional: true }) ?? ACCOUNT_MOCK_SCENARIOS.default;

  getPage(): AccountPageViewModel {
    return {
      status: this.scenario.status,
      title: 'アカウント',
      message: this.scenario.message,
      profile: this.scenario.profile,
      accountStatus: this.scenario.profile ? buildAccountStatus(this.scenario.profile.accountStatus) : undefined,
      sessions: this.scenario.sessions.map((session): AccountSessionViewModel => {
        return {
          id: session.id,
          deviceLabel: session.deviceLabel ?? 'デバイス情報なし',
          createdAtLabel: session.createdAtLabel,
          lastUsedAtLabel: session.lastUsedAtLabel,
          isCurrent: session.isCurrent,
          canRevoke: session.canRevoke,
          revokeUnavailableReason: session.revokeUnavailableReason
        };
      })
    };
  }

  changePassword(_submit: PasswordChangeSubmit): PasswordChangeResult {
    return this.scenario.passwordChangeResult;
  }
}
