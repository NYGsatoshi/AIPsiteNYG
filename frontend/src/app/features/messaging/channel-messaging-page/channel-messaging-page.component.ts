import { Component, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';

import { ConversationListComponent } from '../conversation-list/conversation-list.component';
import { MessageComposerComponent } from '../message-composer/message-composer.component';
import { MessageTimelineComponent } from '../message-timeline/message-timeline.component';
import { MessagingFacade } from '../messaging.facade';
import { ThreadPreviewComponent } from '../thread-preview/thread-preview.component';

@Component({
  selector: 'app-channel-messaging-page',
  standalone: true,
  imports: [
    ConversationListComponent,
    MessageComposerComponent,
    MessageTimelineComponent,
    ThreadPreviewComponent,
  ],
  templateUrl: './channel-messaging-page.component.html',
  styleUrl: './channel-messaging-page.component.scss',
})
export class ChannelMessagingPageComponent {
  readonly facade = inject(MessagingFacade);
  private readonly route = inject(ActivatedRoute);
  readonly page = this.facade.page;

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((paramMap) => {
      this.facade.loadConversation(paramMap.get('conversationId'), 'channel');
    });
  }

  readonly canReadBody = computed(
    () =>
      this.page().conversation.viewerIsParticipant &&
      !this.page().conversation.viewerWasRemoved &&
      this.page().conversation.capabilities.includes('readBody'),
  );

  readonly canPost = computed(
    () =>
      this.canReadBody() &&
      this.page().conversation.capabilities.includes('postMessage') &&
      this.page().status !== 'sessionExpired',
  );

  readonly composerDisabledReason = computed(() => {
    const page = this.page();
    if (page.conversation.viewerWasRemoved) {
      return '参加が解除されたため送信できません';
    }
    if (
      !page.conversation.viewerIsParticipant ||
      !page.conversation.capabilities.includes('readBody')
    ) {
      return 'この会話への参加を確認できません';
    }
    return page.conversation.composerDisabledReason ?? '';
  });

  readonly showComposer = computed(
    () =>
      this.page().conversation.viewerIsParticipant && !this.page().conversation.viewerWasRemoved,
  );

  readonly canViewOthersPreciseReadTimestamps = computed(() =>
    this.page().conversation.capabilities.includes('viewOthersPreciseReadTimestamps'),
  );
}
