import { AccountMockScenario, AccountStatus, AccountStatusViewModel } from './account.types';

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  active: '参加中',
  disabled: '利用停止',
  deleted: '削除済み'
};

const statusMessage = (status: AccountStatus): string => {
  if (status === 'disabled') {
    return 'このアカウントは利用停止中です。必要な操作は管理者に確認してください。';
  }

  if (status === 'deleted') {
    return 'このアカウントは削除済みとして扱われています。';
  }

  return 'このアカウントは参加中です。';
};

export const buildAccountStatus = (status: AccountStatus): AccountStatusViewModel => ({
  accountStatus: status,
  accountStatusLabel: ACCOUNT_STATUS_LABELS[status],
  message: statusMessage(status)
});

export const ACCOUNT_MOCK_SCENARIOS = {
  default: {
    status: 'ready',
    profile: {
      displayName: 'サンプル利用者',
      ownEmail: 'self.account@example.test',
      accountStatus: 'active',
      accountStatusLabel: ACCOUNT_STATUS_LABELS.active,
      roleSummary: 'メンバー / 連絡担当',
      tenantSummary: 'サンプル学園',
      workspaceSummary: '高等部 1-A'
    },
    sessions: [
      {
        id: 'session-current',
        deviceLabel: 'Windows ブラウザー',
        createdAtLabel: '今日',
        lastUsedAtLabel: '数分前',
        isCurrent: true,
        canRevoke: false,
        revokeUnavailableReason: '現在のセッション終了は今後の安全なエンドポイントで有効化します。',
        rawTokenSentinel: 'mock-refresh-token-should-not-render',
        cookieSentinel: 'mock-auth-cookie-should-not-render',
        deviceFingerprintSentinel: 'mock-device-fingerprint-should-not-render',
        ipAddressSentinel: '203.0.113.10'
      },
      {
        id: 'session-secondary',
        deviceLabel: 'モバイル ブラウザー',
        createdAtLabel: '3日前',
        lastUsedAtLabel: '昨日',
        isCurrent: false,
        canRevoke: false,
        revokeUnavailableReason: '失効操作はバックエンド機能が利用可能になるまで表示しません。',
        rawTokenSentinel: 'mock-secondary-token-should-not-render'
      }
    ],
    passwordChangeResult: 'success',
    otherUserEmailSentinel: 'other.member@example.test',
    hiddenAdminFlagSentinel: 'isSuperAdmin=true'
  },
  loading: {
    status: 'loading',
    sessions: [],
    passwordChangeResult: 'success'
  },
  error: {
    status: 'error',
    message: 'アカウント情報を読み込めませんでした。',
    sessions: [],
    passwordChangeResult: 'success'
  },
  permissionDenied: {
    status: 'permissionDenied',
    message: 'アカウント情報を表示する権限がありません。',
    sessions: [],
    passwordChangeResult: 'success'
  },
  noEmailAvailable: {
    status: 'ready',
    profile: {
      displayName: 'サンプル利用者',
      accountStatus: 'active',
      accountStatusLabel: ACCOUNT_STATUS_LABELS.active,
      roleSummary: 'メンバー',
      tenantSummary: 'サンプル学園',
      workspaceSummary: '高等部 1-A'
    },
    sessions: [],
    passwordChangeResult: 'success',
    otherUserEmailSentinel: 'hidden.other@example.test'
  },
  passwordFailure: {
    status: 'ready',
    profile: {
      displayName: 'サンプル利用者',
      ownEmail: 'self.account@example.test',
      accountStatus: 'active',
      accountStatusLabel: ACCOUNT_STATUS_LABELS.active,
      roleSummary: 'メンバー',
      tenantSummary: 'サンプル学園',
      workspaceSummary: '高等部 1-A'
    },
    sessions: [],
    passwordChangeResult: 'failure'
  },
  sessionRevokeUnavailable: {
    status: 'ready',
    profile: {
      displayName: 'サンプル利用者',
      ownEmail: 'self.account@example.test',
      accountStatus: 'active',
      accountStatusLabel: ACCOUNT_STATUS_LABELS.active,
      roleSummary: 'メンバー',
      tenantSummary: 'サンプル学園',
      workspaceSummary: '高等部 1-A'
    },
    sessions: [
      {
        id: 'session-current',
        deviceLabel: 'Windows ブラウザー',
        createdAtLabel: '今日',
        lastUsedAtLabel: '数分前',
        isCurrent: true,
        canRevoke: false,
        revokeUnavailableReason: 'このセッションを終了する操作はまだ利用できません。',
        rawTokenSentinel: 'mock-token-never-render'
      }
    ],
    passwordChangeResult: 'success'
  }
} satisfies Record<string, AccountMockScenario>;
