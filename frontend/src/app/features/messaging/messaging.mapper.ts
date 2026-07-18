import {
  ConversationDetailDto,
  ConversationDto,
  MessageDto
} from './messaging.api';
import {
  MessagingCapability,
  MessagingConversationListItem,
  MessagingMessageViewModel,
  MessagingPageStatus,
  MessagingPageViewModel,
  MessagingRouteKind
} from './messaging.types';

export interface MessagingMapperContext {
  readonly currentUserId: string;
  readonly currentTenantId: string;
  readonly fallbackRouteKind: MessagingRouteKind;
  readonly existingConversations?: readonly MessagingConversationListItem[];
}

export function mapConversationPage(
  conversation: ConversationDetailDto,
  messages: readonly MessageDto[],
  context: MessagingMapperContext
): MessagingPageViewModel {
  const conversationId = stringValue(conversation.id) ?? '';
  const workspaceId = stringValue(conversation.workspaceId);
  const routeKind = routeKindFromApi(conversation.type) ?? context.fallbackRouteKind;
  const viewer = (conversation.members ?? []).find(
    (member) => stringValue(member.userId) === context.currentUserId
  );
  const viewerWasRemoved = viewer?.removedAt !== null && viewer?.removedAt !== undefined;
  const viewerLeft = viewer?.leftAt !== null && viewer?.leftAt !== undefined;
  const viewerIsParticipant = viewer !== undefined && !viewerWasRemoved && !viewerLeft;
  const canRead = viewerIsParticipant && viewer?.canRead === true;
  const canPost = canRead && viewer?.canPost === true && conversation.isLocked !== true && conversation.isArchived !== true;
  const capabilities: MessagingCapability[] = [];

  if (canRead) {
    capabilities.push('readBody', 'viewOwnReadMarker');
  }

  if (canPost) {
    capabilities.push('postMessage');
  }

  const status: MessagingPageStatus = viewerWasRemoved || viewerLeft
    ? 'removedParticipant'
    : !viewerIsParticipant || !canRead
      ? 'permissionDenied'
      : messages.length === 0
        ? 'empty'
        : 'ready';

  return {
    routeKind,
    status,
    title: titleFor(conversation, routeKind, context.currentUserId),
    conversation: {
      id: conversationId,
      kind: routeKind,
      tenantId: context.currentTenantId,
      workspaceId,
      title: titleFor(conversation, routeKind, context.currentUserId),
      subtitle: 'Live API data',
      viewerIsParticipant,
      viewerWasRemoved: viewerWasRemoved || viewerLeft,
      capabilities,
      composerDisabledReason: canPost
        ? undefined
        : 'Posting is not available for this conversation.',
      attachment: {
        mode: 'disabled',
        label: 'Attachments are disabled for MVP0 messaging.'
      }
    },
    conversations: context.existingConversations ?? [],
    messages: messages.map((message) => mapMessage(message, context.currentUserId)),
    draft: '',
    sending: false,
    sendState: { status: 'idle' },
    hasNewMessagesWhileReading: false,
    readCursorBehavior: 'latestVisibleMessage',
    pagingWindow: {
      visibleMessageIds: messages.map((message) => stringValue(message.id) ?? ''),
      preloadBefore: 0,
      preloadAfter: 0
    }
  };
}

export function mapConversationListItem(
  conversation: ConversationDto
): MessagingConversationListItem {
  const id = stringValue(conversation.id) ?? '';
  const kind = routeKindFromApi(conversation.type) ?? 'channel';
  const workspaceId = stringValue(conversation.workspaceId);

  return {
    id,
    kind,
    title: titleFor(conversation, kind),
    route: kind === 'dm' ? `/dm/${id}` : `/workspaces/${workspaceId ?? ''}/channels/${id}`,
    lastActivityLabel: formatDate(conversation.updatedAt) || formatDate(conversation.createdAt),
    safePreviewLabel: stringValue(conversation.lastMessage?.body) ?? '',
    viewerIsParticipant: true,
    unreadCount: numberValue(conversation.unreadCount)
  };
}

export function mapMessage(message: MessageDto, currentUserId: string): MessagingMessageViewModel {
  return {
    id: stringValue(message.id) ?? `message-${Date.now()}`,
    authorLabel: stringValue(message.authorDisplayName) ?? 'Unknown user',
    authorRoleLabel: 'member',
    isOwnMessage: stringValue(message.authorUserId) === currentUserId,
    body: message.isDeleted === true ? '' : (stringValue(message.body) ?? ''),
    createdAt: stringValue(message.createdAt),
    version: numberValue(message.version),
    clientRequestId: stringValue(message.clientRequestId),
    sentAtLabel: formatDate(message.createdAt),
    deliveryState: 'confirmed',
    retryAllowed: false
  };
}

export function routeKindFromApi(value: unknown): MessagingRouteKind | null {
  if (value === 0) {
    return 'dm';
  }

  const normalized = String(value ?? '').toLowerCase();
  if (!normalized) {
    return null;
  }

  return normalized.includes('direct') ? 'dm' : 'channel';
}

function titleFor(conversation: ConversationDto, routeKind: MessagingRouteKind, currentUserId?: string): string {
  const title = stringValue(conversation.title);
  if (title) {
    return title;
  }

  const members = (conversation as { members?: readonly { userId?: unknown; displayName?: unknown }[] }).members ?? [];
  if (routeKind === 'dm' && members.length > 0) {
    const recipient = members.find((member) => stringValue(member.userId) !== currentUserId);
    const displayName = stringValue(recipient?.displayName);
    if (displayName) {
      return displayName;
    }
  }

  return routeKind === 'dm' ? 'Direct message' : 'Conversation';
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function formatDate(value: unknown): string {
  const raw = stringValue(value);
  return raw ? new Date(raw).toLocaleString() : '';
}
