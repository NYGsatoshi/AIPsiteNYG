import { DOCUMENT } from '@angular/common';
import { computed, effect, inject, Injectable, signal } from '@angular/core';

export type AppLocale = 'en' | 'ja';

export interface AppLocaleOption {
  readonly value: AppLocale;
  readonly languageTag: 'en' | 'ja';
  readonly nativeName: string;
}

const LOCALE_STORAGE_KEY = 'aip.locale';

export const APP_LOCALES: readonly AppLocaleOption[] = [
  { value: 'ja', languageTag: 'ja', nativeName: '日本語' },
  { value: 'en', languageTag: 'en', nativeName: 'English' }
];

const ENGLISH_TRANSLATIONS = {
  'account.eyebrow': 'Account',
  'account.loading': 'Loading account information…',
  'account.loadErrorTitle': 'Could not load your account',
  'account.loadErrorMessage': 'Your account information could not be loaded.',
  'account.permissionDenied': 'You do not have permission to view account information.',
  'account.profile': 'Profile',
  'account.email': 'Email',
  'account.emailUnavailable': 'No email address is available.',
  'account.status': 'Status',
  'account.role': 'Role',
  'account.tenant': 'Tenant',
  'account.workspace': 'Workspace',
  'account.status.active': 'Active',
  'account.status.disabled': 'Disabled',
  'account.status.deleted': 'Deleted',
  'account.status.activeMessage': 'This account is active.',
  'account.status.disabledMessage': 'This account is disabled.',
  'account.status.deletedMessage': 'This account is deleted.',
  'language.eyebrow': 'Preferences',
  'language.title': 'Language',
  'language.label': 'Display language',
  'language.description': 'Changes apply immediately and are saved in this browser.',
  'language.saved': 'Display language saved.',
  'password.eyebrow': 'Password',
  'password.title': 'Change password',
  'password.success': 'Password changed.',
  'password.failure': 'Password change failed. Check the current password and try again.',
  'password.pending': 'Changing password…',
  'password.current': 'Current password',
  'password.new': 'New password',
  'password.confirm': 'Confirm new password',
  'password.submit': 'Change password',
  'password.submitting': 'Changing…',
  'password.currentRequired': 'Enter your current password.',
  'password.newRequired': 'Enter a new password.',
  'password.confirmRequired': 'Confirm your new password.',
  'password.mismatch': 'The new passwords do not match.',
  'sessions.eyebrow': 'Sessions',
  'sessions.title': 'Sessions',
  'sessions.empty': 'There are no sessions to display.',
  'sessions.current': 'Current session',
  'sessions.created': 'Created',
  'sessions.lastUsed': 'Last used',
  'sessions.revoke': 'Revoke this session',
  'sessions.revokeUnavailable': 'This session cannot be revoked.',
  'notifications.eyebrow': 'Current Workspace',
  'notifications.title': 'Task notification timing',
  'notifications.refresh': 'Refresh',
  'notifications.idle': 'Choose an active Workspace to view this preference.',
  'notifications.loading': 'Loading the current Workspace preference…',
  'notifications.timezone': 'Workspace timezone:',
  'notifications.digestTime': 'Daily task deadline digest time',
  'notifications.inherit': 'Use Workspace default (effective {{time}})',
  'notifications.savedValue': 'The saved value is {{value}}. Times are evaluated in the Workspace timezone.',
  'notifications.inherited': 'inherited',
  'notifications.saving': 'Saving preference…',
  'shell.skipToMain': 'Skip to main content',
  'shell.workspaceNavigation': 'Workspace navigation',
  'shell.mainContent': 'Main content',
  'shell.mobileNavigation': 'Mobile navigation',
  'shell.mobileControls': 'Mobile workspace controls',
  'shell.openNavigation': 'Open navigation menu',
  'shell.closeNavigation': 'Close navigation menu',
  'shell.workspaceNotSelected': 'No Workspace selected',
  'shell.accountSwitcher': 'Account switcher',
  'shell.signedInUsers': 'Signed-in users',
  'topBar.primaryHeader': 'Primary workspace header',
  'topBar.workspace': 'Workspace',
  'topBar.selectWorkspace': 'Select a Workspace',
  'topBar.loadingWorkspaces': 'Loading Workspaces',
  'topBar.chooseWorkspace': 'Choose a Workspace to continue',
  'topBar.workspaceUnavailable': 'Workspace unavailable',
  'topBar.workspaceNotSelected': 'Workspace not selected',
  'topBar.researchStatus': 'Research status',
  'topBar.research': 'Research',
  'topBar.running': 'Running',
  'topBar.needsReview': 'Needs review',
  'topBar.statusUnavailable': 'Status unavailable',
  'topBar.sessionExpired': 'Session expired',
  'topBar.workspaceActions': 'Workspace actions',
  'topBar.members': 'Members',
  'topBar.globalActions': 'Global actions',
  'topBar.notifications': 'Notifications',
  'topBar.closeNotifications': 'Close notifications',
  'topBar.account': 'Account',
  'topBar.logout': 'Logout',
  'topBar.loggingOut': 'Logging out',
  'featureMenu.menu': 'Menu',
  'featureMenu.main': 'Main',
  'featureMenu.pinned': 'Pinned',
  'featureMenu.pinnedNavigation': 'Pinned navigation',
  'featureMenu.showMenu': 'Show menu',
  'featureMenu.hideMenu': 'Hide menu',
  'featureMenu.showPinned': 'Show pinned items',
  'featureMenu.hidePinned': 'Hide pinned items',
  'featureMenu.noPinned': 'No pinned items yet.',
  'featureMenu.moveUp': 'Move {{item}} up',
  'featureMenu.moveDown': 'Move {{item}} down',
  'featureMenu.pinPrefix': 'Pinned: {{item}}',
  'nav.workspaces': 'Workspaces',
  'nav.messages': 'Messages',
  'nav.announcements': 'Announcements',
  'nav.files': 'Files',
  'nav.account': 'Account',
  'nav.audit': 'Audit',
  'nav.invites': 'Invites',
  'nav.projects': 'Projects',
  'nav.my-tasks': 'My Tasks',
  'login.eyebrow': 'Account',
  'login.title': 'Sign in',
  'login.email': 'Email address',
  'login.password': 'Password',
  'login.submit': 'Sign in',
  'login.submitting': 'Signing in…',
  'login.failure': 'The email address or password is incorrect.'
} as const;

type TranslationKey = keyof typeof ENGLISH_TRANSLATIONS;

const JAPANESE_TRANSLATIONS: Record<TranslationKey, string> = {
  'account.eyebrow': 'アカウント',
  'account.loading': 'アカウント情報を読み込み中…',
  'account.loadErrorTitle': 'アカウントを読み込めませんでした',
  'account.loadErrorMessage': 'アカウント情報を読み込めませんでした。',
  'account.permissionDenied': 'アカウント情報を表示する権限がありません。',
  'account.profile': 'プロフィール',
  'account.email': 'メール',
  'account.emailUnavailable': '表示できるメールはありません',
  'account.status': '状態',
  'account.role': 'ロール',
  'account.tenant': 'テナント',
  'account.workspace': 'ワークスペース',
  'account.status.active': '有効',
  'account.status.disabled': '無効',
  'account.status.deleted': '削除済み',
  'account.status.activeMessage': 'このアカウントは有効です。',
  'account.status.disabledMessage': 'このアカウントは無効です。',
  'account.status.deletedMessage': 'このアカウントは削除済みです。',
  'language.eyebrow': '設定',
  'language.title': '言語',
  'language.label': '表示言語',
  'language.description': '変更はすぐに反映され、このブラウザーに保存されます。',
  'language.saved': '表示言語を保存しました。',
  'password.eyebrow': 'パスワード',
  'password.title': 'パスワードを変更',
  'password.success': 'パスワードを変更しました。',
  'password.failure': 'パスワードを変更できませんでした。現在のパスワードを確認して、もう一度お試しください。',
  'password.pending': 'パスワードを変更中…',
  'password.current': '現在のパスワード',
  'password.new': '新しいパスワード',
  'password.confirm': '新しいパスワード（確認）',
  'password.submit': 'パスワードを変更',
  'password.submitting': '変更中…',
  'password.currentRequired': '現在のパスワードを入力してください。',
  'password.newRequired': '新しいパスワードを入力してください。',
  'password.confirmRequired': '確認用パスワードを入力してください。',
  'password.mismatch': '新しいパスワードが一致しません。',
  'sessions.eyebrow': 'セッション',
  'sessions.title': 'セッション',
  'sessions.empty': '表示できるセッションはありません。',
  'sessions.current': '現在のセッション',
  'sessions.created': '作成日',
  'sessions.lastUsed': '最終利用',
  'sessions.revoke': 'このセッションを取り消す',
  'sessions.revokeUnavailable': 'このセッションは取り消せません。',
  'notifications.eyebrow': '現在のワークスペース',
  'notifications.title': 'タスク通知の時刻',
  'notifications.refresh': '更新',
  'notifications.idle': 'この設定を表示するには、アクティブなワークスペースを選択してください。',
  'notifications.loading': '現在のワークスペース設定を読み込み中…',
  'notifications.timezone': 'ワークスペースのタイムゾーン:',
  'notifications.digestTime': '毎日のタスク期限ダイジェスト時刻',
  'notifications.inherit': 'ワークスペースの既定値を使用（有効値: {{time}}）',
  'notifications.savedValue': '保存済みの値は {{value}} です。時刻はワークスペースのタイムゾーンで評価されます。',
  'notifications.inherited': '継承',
  'notifications.saving': '設定を保存中…',
  'shell.skipToMain': 'メインコンテンツへ移動',
  'shell.workspaceNavigation': 'ワークスペース ナビゲーション',
  'shell.mainContent': 'メインコンテンツ',
  'shell.mobileNavigation': 'モバイルナビゲーション',
  'shell.mobileControls': 'モバイルのワークスペース操作',
  'shell.openNavigation': 'ナビゲーションメニューを開く',
  'shell.closeNavigation': 'ナビゲーションメニューを閉じる',
  'shell.workspaceNotSelected': 'ワークスペース未選択',
  'shell.accountSwitcher': 'アカウント切り替え',
  'shell.signedInUsers': 'ログイン中のユーザー',
  'topBar.primaryHeader': 'ワークスペースのヘッダー',
  'topBar.workspace': 'ワークスペース',
  'topBar.selectWorkspace': 'ワークスペースを選択',
  'topBar.loadingWorkspaces': 'ワークスペースを読み込み中',
  'topBar.chooseWorkspace': '続行するにはワークスペースを選択してください',
  'topBar.workspaceUnavailable': 'ワークスペースを利用できません',
  'topBar.workspaceNotSelected': 'ワークスペース未選択',
  'topBar.researchStatus': '研究の状況',
  'topBar.research': '研究',
  'topBar.running': '進行中',
  'topBar.needsReview': '要レビュー',
  'topBar.statusUnavailable': '状況を取得できません',
  'topBar.sessionExpired': 'セッションの有効期限が切れました',
  'topBar.workspaceActions': 'ワークスペースの操作',
  'topBar.members': 'メンバー',
  'topBar.globalActions': '共通の操作',
  'topBar.notifications': '通知',
  'topBar.closeNotifications': '通知を閉じる',
  'topBar.account': 'アカウント',
  'topBar.logout': 'ログアウト',
  'topBar.loggingOut': 'ログアウト中',
  'featureMenu.menu': 'メニュー',
  'featureMenu.main': 'メイン',
  'featureMenu.pinned': 'ピン留め',
  'featureMenu.pinnedNavigation': 'ピン留めしたナビゲーション',
  'featureMenu.showMenu': 'メニューを開く',
  'featureMenu.hideMenu': 'メニューを閉じる',
  'featureMenu.showPinned': 'ピン留めを表示',
  'featureMenu.hidePinned': 'ピン留めを非表示',
  'featureMenu.noPinned': 'ピン留めした項目はありません。',
  'featureMenu.moveUp': '{{item}}を上へ移動',
  'featureMenu.moveDown': '{{item}}を下へ移動',
  'featureMenu.pinPrefix': 'ピン留め: {{item}}',
  'nav.workspaces': 'ワークスペース',
  'nav.messages': 'メッセージ',
  'nav.announcements': 'お知らせ',
  'nav.files': 'ファイル',
  'nav.account': 'アカウント',
  'nav.audit': '監査',
  'nav.invites': '招待',
  'nav.projects': 'プロジェクト',
  'nav.my-tasks': '自分のタスク',
  'login.eyebrow': 'アカウント',
  'login.title': 'ログイン',
  'login.email': 'メールアドレス',
  'login.password': 'パスワード',
  'login.submit': 'ログイン',
  'login.submitting': 'ログイン中…',
  'login.failure': 'メールアドレスまたはパスワードを確認してください。'
};

const TRANSLATIONS: Record<AppLocale, Record<TranslationKey, string>> = {
  en: ENGLISH_TRANSLATIONS,
  ja: JAPANESE_TRANSLATIONS
};

@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly document = inject(DOCUMENT);
  private readonly localeState = signal<AppLocale>(readStoredLocale());

  readonly locale = this.localeState.asReadonly();
  readonly localeTag = computed(() => localeOption(this.locale()).languageTag);
  readonly localeOptions = APP_LOCALES;

  constructor() {
    effect(() => {
      const locale = this.locale();
      this.document.documentElement.lang = localeOption(locale).languageTag;
      persistLocale(locale);
    });
  }

  setLocale(locale: AppLocale): void {
    this.localeState.set(locale);
  }

  translate(key: TranslationKey, parameters: Readonly<Record<string, string | number>> = {}): string {
    return interpolate(TRANSLATIONS[this.locale()][key], parameters);
  }

  navigationLabel(id: string, fallback: string): string {
    const key = `nav.${id}` as TranslationKey;
    return key in ENGLISH_TRANSLATIONS ? this.translate(key) : fallback;
  }

  accountStatusLabel(status: 'active' | 'disabled' | 'deleted'): string {
    return this.translate(`account.status.${status}` as TranslationKey);
  }

  accountStatusMessage(status: 'active' | 'disabled' | 'deleted'): string {
    return this.translate(`account.status.${status}Message` as TranslationKey);
  }

  formatDateTime(value: Date | string | number, options: Intl.DateTimeFormatOptions = {}): string {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(this.localeTag(), options).format(date);
  }

  formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
    return new Intl.NumberFormat(this.localeTag(), options).format(value);
  }
}

function localeOption(locale: AppLocale): AppLocaleOption {
  return APP_LOCALES.find((option) => option.value === locale) ?? APP_LOCALES[0];
}

function readStoredLocale(): AppLocale {
  try {
    return window.localStorage.getItem(LOCALE_STORAGE_KEY) === 'en' ? 'en' : 'ja';
  } catch {
    return 'ja';
  }
}

function persistLocale(locale: AppLocale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // A blocked browser storage area must not prevent the application rendering.
  }
}

function interpolate(template: string, parameters: Readonly<Record<string, string | number>>): string {
  return template.replace(new RegExp('[{][{](\\w+)[}][}]', 'gu'), (match, key: string) => String(parameters[key] ?? match));
}
