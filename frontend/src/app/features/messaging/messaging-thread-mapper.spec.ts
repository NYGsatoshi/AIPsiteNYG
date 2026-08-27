import { MessageThreadDto } from './messaging.api';
import { mapMessageThread } from './messaging.mapper';

describe('Issue 362 authoritative thread mapper', () => {
  it('maps only bounded projections with stable root and reply identities', () => {
    const valid = threadDto();
    const mapped = mapMessageThread(valid, 'current-user');

    expect(mapped).toMatchObject({
      status: 'ready',
      rootMessageId: 'root-a',
      hasMore: false,
      maximumReplies: 100,
      summary: { replyCount: 1, participantDisplayNames: ['User B'] }
    });
    expect(mapped?.replies.map((reply) => reply.id)).toEqual(['reply-a']);

    expect(mapMessageThread({ ...valid, rootMessage: { ...valid.rootMessage, id: '' } }, 'current-user')).toBeNull();
    expect(mapMessageThread({
      ...valid,
      replies: [{ ...valid.replies?.[0], id: undefined }]
    }, 'current-user')).toBeNull();
    expect(mapMessageThread({
      ...valid,
      replies: [valid.replies![0], { ...valid.replies![0] }]
    }, 'current-user')).toBeNull();
    expect(mapMessageThread({
      ...valid,
      summary: { ...valid.summary, replyCount: 1.5 }
    }, 'current-user')).toBeNull();
    expect(mapMessageThread({ ...valid, maximumReplies: -1 }, 'current-user')).toBeNull();
    expect(mapMessageThread({ ...valid, maximumReplies: 1.5 }, 'current-user')).toBeNull();
  });
});

function threadDto(): MessageThreadDto {
  const rootMessage = {
    id: 'root-a',
    conversationId: 'conversation-a',
    authorUserId: 'user-b',
    authorDisplayName: 'User B',
    body: 'Root',
    createdAt: '2026-08-27T01:00:00Z',
    isDeleted: false
  };
  const reply = {
    id: 'reply-a',
    conversationId: 'conversation-a',
    threadRootMessageId: 'root-a',
    authorUserId: 'user-b',
    authorDisplayName: 'User B',
    body: 'Reply',
    createdAt: '2026-08-27T02:00:00Z',
    isDeleted: false
  };
  return {
    rootMessage,
    replies: [reply],
    summary: {
      threadRootMessageId: 'root-a',
      replyCount: 1,
      latestReplyAt: '2026-08-27T02:00:00Z',
      participantDisplayNames: ['User B']
    },
    hasMore: false,
    maximumReplies: 100
  };
}
