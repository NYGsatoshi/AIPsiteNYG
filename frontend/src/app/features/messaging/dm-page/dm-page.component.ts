import { Component, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { ConversationSettingsPanelComponent } from '../conversation-settings-panel/conversation-settings-panel.component';
import { MessageComposerComponent } from '../message-composer/message-composer.component';
import { MessageNavigationStateService } from '../message-navigation-state.service';
import { MessageTimelineComponent } from '../message-timeline/message-timeline.component';
import { MessagingFacade } from '../messaging.facade';
import { RealtimeFacade } from '../../../core/realtime/realtime.facade';
import { ThreadPreviewComponent } from '../thread-preview/thread-preview.component';

@Component({
  selector: 'app-dm-page',
  standalone: true,
  imports: [
    ConversationSettingsPanelComponent,
    MessageComposerComponent,
    MessageTimelineComponent,
    RouterLink,
    ThreadPreviewComponent,
  ],
  templateUrl: './dm-page.component.html',
  styleUrl: './dm-page.component.scss',
})
export class DmPageComponent {
  readonly facade = inject(MessagingFacade);
  readonly realtime = inject(RealtimeFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly navigationState = inject(MessageNavigationStateService);
  readonly page = this.facade.page;

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((paramMap) => {
      this.navigationState.resetDetailScroll();
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

  readonly canCreateThread = computed(() =>
    this.canPost() && this.page().conversation.capabilities.includes('createThread'),
  );

  readonly threadOpen = computed(() => this.facade.thread().status !== 'closed');

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
