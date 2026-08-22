import { Component, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';

import { ConversationSettingsPanelComponent } from '../conversation-settings-panel/conversation-settings-panel.component';
import { MessageComposerComponent } from '../message-composer/message-composer.component';
import { MessageTimelineComponent } from '../message-timeline/message-timeline.component';
import { MessagingFacade } from '../messaging.facade';
import { RealtimeFacade } from '../../../core/realtime/realtime.facade';

@Component({
  selector: 'app-dm-page',
  standalone: true,
  imports: [ConversationSettingsPanelComponent, MessageComposerComponent, MessageTimelineComponent],
  templateUrl: './dm-page.component.html',
  styleUrl: './dm-page.component.scss',
})
export class DmPageComponent {
  readonly facade = inject(MessagingFacade);
  readonly realtime = inject(RealtimeFacade);
  private readonly route = inject(ActivatedRoute);
  readonly page = this.facade.page;

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((paramMap) => {
      this.facade.loadConversation(paramMap.get('conversationId'), 'dm');
    });
  }

  readonly canReadBody = computed(
    () =>
      this.page().conversation.kind === 'dm' &&
      this.page().conversation.viewerIsParticipant &&
      !this.page().conversation.viewerWasRemoved &&
      this.page().conversation.capabilities.includes('readBody'),
  );

  readonly canPost = computed(
    () => this.canReadBody() && this.page().conversation.capabilities.includes('postMessage'),
  );

  readonly showComposer = computed(
    () =>
      this.page().conversation.viewerIsParticipant && !this.page().conversation.viewerWasRemoved,
  );

  readonly composerDisabledReason = computed(() => {
    const page = this.page();
    if (!page.conversation.viewerIsParticipant) {
      return 'DM参加者ではないため送信できません';
    }
    return page.conversation.composerDisabledReason ?? '';
  });
}
