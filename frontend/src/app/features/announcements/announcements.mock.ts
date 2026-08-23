import { AnnouncementsPageViewModel, AnnouncementViewModel } from './announcements.types';

export const LONG_ANNOUNCEMENT_BODY =
  'これは長い本文の表示確認用です。架空の学習予定、持ち物、提出期限をまとめています。'.repeat(12);

export const DEFAULT_ANNOUNCEMENTS: readonly AnnouncementViewModel[] = [
  {
    id: 'mock-announcement-001',
    title: '来週の学習予定について',
    body: '来週は探究活動のまとめを行います。各自、配付済みの記録用紙を確認してください。',
    detailState: 'loaded',
    priority: 'important',
    audienceScope: 'allWorkspaceMembers',
    publishedAtLabel: '2026年7月1日 09:00',
    publicationState: 'published',
    readState: {
      requiresReadConfirmation: true,
      isRead: false
    },
    capabilities: ['readAnnouncement', 'editAnnouncement'],
    notificationTarget: 'announcementDetail'
  },
  {
    id: 'mock-announcement-002',
    title: '保護者向け面談資料の確認',
    body: '面談前に共有資料の内容を確認してください。個人情報は含まない架空のサンプル資料です。',
    detailState: 'loaded',
    priority: 'normal',
    audienceScope: 'guardiansOnly',
    publishedAtLabel: '2026年6月30日 16:30',
    publicationState: 'published',
    readState: {
      requiresReadConfirmation: false,
      isRead: true,
      confirmedAtLabel: '確認済み'
    },
    capabilities: ['readAnnouncement'],
    notificationTarget: 'announcementDetail',
    attachment: {
      mode: 'disabled',
      label: '添付ファイルはP0モックでは無効です'
    }
  },
  {
    id: 'mock-announcement-003',
    title: '下書き: 校内掲示の更新案',
    body: 'この下書きは編集状態の確認用です。公開前の安全な架空データのみを使用しています。',
    detailState: 'loaded',
    priority: 'critical',
    audienceScope: 'teachersOnly',
    publishedAtLabel: '下書き',
    publicationState: 'draft',
    readState: {
      requiresReadConfirmation: true,
      isRead: false
    },
    capabilities: ['readAnnouncement', 'editAnnouncement'],
    notificationTarget: 'announcementDetail'
  }
];

export const HIDDEN_ANNOUNCEMENT_TITLE = '非表示のお知らせタイトル';
export const HIDDEN_ANNOUNCEMENT_BODY = '非表示のお知らせ本文';

export const DEFAULT_ANNOUNCEMENTS_PAGE: AnnouncementsPageViewModel = {
  status: 'ready',
  title: 'お知らせ',
  announcements: DEFAULT_ANNOUNCEMENTS,
  selectedAnnouncementId: DEFAULT_ANNOUNCEMENTS[0].id,
  pageCapabilities: ['readAnnouncement', 'createAnnouncement', 'editAnnouncement'],
  editorDraft: {
    title: '',
    body: '',
    priority: 'normal',
    audienceScope: 'allWorkspaceMembers',
    requiresReadConfirmation: false
  }
};

export const ANNOUNCEMENT_PAGE_SCENARIOS = {
  default: DEFAULT_ANNOUNCEMENTS_PAGE,
  loading: {
    ...DEFAULT_ANNOUNCEMENTS_PAGE,
    status: 'loading',
    announcements: [],
    selectedAnnouncementId: null
  },
  empty: {
    ...DEFAULT_ANNOUNCEMENTS_PAGE,
    status: 'empty',
    announcements: [],
    selectedAnnouncementId: null
  },
  error: {
    ...DEFAULT_ANNOUNCEMENTS_PAGE,
    status: 'error',
    announcements: [],
    selectedAnnouncementId: null,
    message: 'お知らせを読み込めませんでした。'
  },
  permissionDenied: {
    ...DEFAULT_ANNOUNCEMENTS_PAGE,
    status: 'permissionDenied',
    announcements: [],
    selectedAnnouncementId: 'hidden-announcement',
    pageCapabilities: [],
    message: 'このお知らせを表示する権限がありません。'
  },
  noCreatePermission: {
    ...DEFAULT_ANNOUNCEMENTS_PAGE,
    pageCapabilities: ['readAnnouncement']
  },
  longBody: {
    ...DEFAULT_ANNOUNCEMENTS_PAGE,
    announcements: [
      {
        ...DEFAULT_ANNOUNCEMENTS[0],
        title: 'とても長いタイトルの表示確認用お知らせとても長いタイトルの表示確認用お知らせ',
        body: LONG_ANNOUNCEMENT_BODY
      }
    ],
    selectedAnnouncementId: DEFAULT_ANNOUNCEMENTS[0].id
  },
  audienceScopePreview: {
    ...DEFAULT_ANNOUNCEMENTS_PAGE,
    selectedAnnouncementId: DEFAULT_ANNOUNCEMENTS[1].id
  },
  attachmentDisabled: {
    ...DEFAULT_ANNOUNCEMENTS_PAGE,
    selectedAnnouncementId: DEFAULT_ANNOUNCEMENTS[1].id
  },
  recordAccessDenied: {
    ...DEFAULT_ANNOUNCEMENTS_PAGE,
    status: 'recordAccessDenied',
    announcements: [],
    selectedAnnouncementId: 'hidden-announcement',
    message: 'このお知らせを表示する権限がありません。'
  },
  unsafeBody: {
    ...DEFAULT_ANNOUNCEMENTS_PAGE,
    announcements: [
      {
        ...DEFAULT_ANNOUNCEMENTS[0],
        body: '<img src=x onerror=alert(1)>本文は文字として表示します。'
      }
    ],
    selectedAnnouncementId: DEFAULT_ANNOUNCEMENTS[0].id
  }
} satisfies Record<string, AnnouncementsPageViewModel>;
