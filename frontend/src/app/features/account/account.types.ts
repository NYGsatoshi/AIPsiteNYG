export type AccountPageStatus = 'ready' | 'loading' | 'error' | 'permissionDenied';

export type AccountStatus = 'active' | 'disabled' | 'deleted';

export interface AccountProfileViewModel {
  readonly displayName: string;
  readonly ownEmail?: string;
  readonly accountStatus: AccountStatus;
  readonly accountStatusLabel: string;
  readonly roleSummary: string;
  readonly tenantSummary: string;
  readonly workspaceSummary: string;
}

export interface AccountSessionViewModel {
  readonly id: string;
  readonly deviceLabel: string;
  readonly createdAtLabel?: string;
  readonly lastUsedAtLabel?: string;
  readonly isCurrent: boolean;
  readonly canRevoke: boolean;
  readonly revokeUnavailableReason?: string;
}

export interface AccountStatusViewModel {
  readonly accountStatus: AccountStatus;
  readonly accountStatusLabel: string;
  readonly message: string;
}

export interface AccountPageViewModel {
  readonly status: AccountPageStatus;
  readonly title: string;
  readonly message?: string;
  readonly profile?: AccountProfileViewModel;
  readonly accountStatus?: AccountStatusViewModel;
  readonly sessions: readonly AccountSessionViewModel[];
}

export interface PasswordChangeSubmit {
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly confirmNewPassword: string;
}

export type PasswordChangeResult = 'success' | 'failure';

export interface AccountMockSession {
  readonly id: string;
  readonly deviceLabel?: string;
  readonly createdAtLabel?: string;
  readonly lastUsedAtLabel?: string;
  readonly isCurrent: boolean;
  readonly canRevoke: boolean;
  readonly revokeUnavailableReason?: string;
  readonly rawTokenSentinel?: string;
  readonly cookieSentinel?: string;
  readonly deviceFingerprintSentinel?: string;
  readonly ipAddressSentinel?: string;
}

export interface AccountMockScenario {
  readonly status: AccountPageStatus;
  readonly message?: string;
  readonly profile?: AccountProfileViewModel;
  readonly sessions: readonly AccountMockSession[];
  readonly passwordChangeResult: PasswordChangeResult;
  readonly otherUserEmailSentinel?: string;
  readonly hiddenAdminFlagSentinel?: string;
}
