import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { ConversationListComponent } from '../conversation-list/conversation-list.component';
import { ConversationSettingsPanelComponent } from '../conversation-settings-panel/conversation-settings-panel.component';
import { MessageGlobalSettingsService } from '../message-global-settings.service';
import { MessageComposerComponent } from '../message-composer/message-composer.component';
import { MessageNavigationStateService } from '../message-navigation-state.service';
import { MessageTimelineComponent } from '../message-timeline/message-timeline.component';
import { MessagingFacade } from '../messaging.facade';
import { RealtimeFacade } from '../../../core/realtime/realtime.facade';
import { ActiveWorkspaceFacade } from '../../../core/workspace/active-workspace.facade';
import { ThreadPreviewComponent } from '../thread-preview/thread-preview.component';

@Component({
  selector: 'app-channel-messaging-page',
  standalone: true,
  imports: [
    ConversationListComponent,
    ConversationSettingsPanelComponent,
    MessageComposerComponent,
    MessageTimelineComponent,
    RouterLink,
    ThreadPreviewComponent,
  ],
  templateUrl: './channel-messaging-page.component.html',
  styleUrl: './channel-messaging-page.component.scss',
})
export class ChannelMessagingPageComponent {
  readonly facade = inject(MessagingFacade);
  readonly realtime = inject(RealtimeFacade);
  readonly globalSettings = inject(MessageGlobalSettingsService);
  private readonly route = inject(ActivatedRoute);
  private readonly activeWorkspace = inject(ActiveWorkspaceFacade);
  private readonly navigationState = inject(MessageNavigationStateService);
  private readonly routeContext = signal<{
    readonly conversationId: string | null;
    readonly workspaceId: string | null;
  }>({ conversationId: null, workspaceId: null });
  private hasObservedActiveWorkspace = false;
  private lastLoadKey: string | null = null;
  readonly page = this.facade.page;

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((paramMap) => {
      this.navigationState.resetDetailScroll();
      this.routeContext.set({
        conversationId: paramMap.get('conversationId'),
        workspaceId: paramMap.get('workspaceId'),
      });
      this.loadForCommittedScope();
    });

    effect(() => {
      this.routeContext();
      this.activeWorkspace.activeWorkspace();
      this.loadForCommittedScope();
    });
  }

  private loadForCommittedScope(): void {
    const context = this.routeContext();
    const activeWorkspaceId = this.activeWorkspace.activeWorkspace()?.id ?? null;
    if (activeWorkspaceId) {
      this.hasObservedActiveWorkspace = true;
    }

    // During B -> A navigation, Angular may construct the A component before
    // NavigationEnd commits A. Do not start A requests under B. A first deep
    // link from null is safe because the guard already validated the route
    // and null -> A is deliberately non-destructive.
    if (
      (activeWorkspaceId && context.workspaceId && activeWorkspaceId !== context.workspaceId) ||
      (!activeWorkspaceId && this.hasObservedActiveWorkspace)
    ) {
      return;
    }

    const expectedWorkspaceId = context.workspaceId ?? activeWorkspaceId;
    const loadKey = `${context.conversationId ?? ''}:${expectedWorkspaceId ?? ''}`;
    if (loadKey === this.lastLoadKey) {
      return;
    }
    this.lastLoadKey = loadKey;
    this.facade.loadConversation(
      context.conversationId,
      'channel',
      expectedWorkspaceId,
    );
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
