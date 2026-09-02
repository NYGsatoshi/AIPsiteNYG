import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  AnnouncementAudienceOption,
  AnnouncementEditorDraft,
  AnnouncementEditorSubmission,
} from '../announcements.types';
import { AnnouncementMultiAudienceEditorComponent } from './announcement-multi-audience-editor.component';

const groupAudience: AnnouncementAudienceOption = {
  key: 'group:11111111-1111-1111-1111-111111111111',
  scope: 'group',
  displayName: 'Teachers',
  recipientCount: 10,
  workspaceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  groupId: '11111111-1111-1111-1111-111111111111',
  scheduleTimeZoneId: 'Asia/Tokyo',
};

const channelAudience: AnnouncementAudienceOption = {
  key: 'channel:22222222-2222-2222-2222-222222222222',
  scope: 'channel',
  displayName: 'Teachers / Announcements',
  recipientCount: 11,
  workspaceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  groupId: '11111111-1111-1111-1111-111111111111',
  channelId: '22222222-2222-2222-2222-222222222222',
  scheduleTimeZoneId: 'Asia/Tokyo',
};

const otherZoneAudience: AnnouncementAudienceOption = {
  key: 'group:33333333-3333-3333-3333-333333333333',
  scope: 'group',
  displayName: 'London Club',
  recipientCount: 5,
  workspaceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  groupId: '33333333-3333-3333-3333-333333333333',
  scheduleTimeZoneId: 'Europe/London',
};

const draft = (
  overrides: Partial<AnnouncementEditorDraft> = {},
): AnnouncementEditorDraft => ({
  title: 'School update',
  body: 'Announcement body',
  priority: 'normal',
  audienceKey: groupAudience.key,
  audienceKeys: [groupAudience.key],
  availableAudiences: [groupAudience, channelAudience, otherZoneAudience],
  requiresReadConfirmation: false,
  publicationState: 'draft',
  ...overrides,
});

const submission = (
  overrides: Partial<AnnouncementEditorSubmission> = {},
): AnnouncementEditorSubmission => ({
  title: 'School update',
  body: 'Announcement body',
  priority: 'normal',
  audience: groupAudience,
  requiresReadConfirmation: false,
  deliveryMode: 'now',
  ...overrides,
});

async function render(
  value: AnnouncementEditorDraft = draft(),
): Promise<ComponentFixture<AnnouncementMultiAudienceEditorComponent>> {
  await TestBed.configureTestingModule({
    imports: [AnnouncementMultiAudienceEditorComponent],
  }).compileComponents();
  const fixture = TestBed.createComponent(AnnouncementMultiAudienceEditorComponent);
  fixture.componentRef.setInput('draft', value);
  fixture.detectChanges();
  return fixture;
}

describe('AnnouncementMultiAudienceEditorComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('adds and removes authorized targets by name while keeping the primary target', async () => {
    const fixture = await render();
    const emitted: AnnouncementEditorDraft[] = [];
    fixture.componentInstance.draftChanged.subscribe((value) => emitted.push(value));

    fixture.componentInstance.toggleAudience(channelAudience.key, true);
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedKeys()).toEqual([
      groupAudience.key,
      channelAudience.key,
    ]);
    expect(emitted.at(-1)?.audienceKeys).toEqual([groupAudience.key, channelAudience.key]);
    const summary = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="announcement-multi-audience-summary"]',
    )?.textContent ?? '';
    expect(summary).toContain('Teachers');
    expect(summary).toContain('Teachers / Announcements');
    expect(summary).toContain('21');

    fixture.componentInstance.removeAudience(channelAudience.key);
    expect(fixture.componentInstance.selectedKeys()).toEqual([groupAudience.key]);
  });

  it('invalidates unsaved create and transition replay identities when the target set changes', async () => {
    const fixture = await render(
      draft({
        createIdempotencyKey: 'announcement-draft-create-old-key',
        transitionIdempotencyKey: 'announcement-draft-transition-old-key',
      }),
    );
    const emitted: AnnouncementEditorDraft[] = [];
    fixture.componentInstance.draftChanged.subscribe((value) => emitted.push(value));

    fixture.componentInstance.toggleAudience(channelAudience.key, true);

    const changed = emitted.at(-1);
    expect(changed?.audienceKeys).toEqual([groupAudience.key, channelAudience.key]);
    expect(changed?.createIdempotencyKey).toBeUndefined();
    expect(changed?.transitionIdempotencyKey).toBeUndefined();
  });

  it('does not emit publication until the all-target review is explicitly confirmed', async () => {
    const fixture = await render();
    fixture.componentInstance.toggleAudience(channelAudience.key, true);
    const emitted: AnnouncementEditorSubmission[] = [];
    fixture.componentInstance.publishRequested.subscribe((value) => emitted.push(value));

    fixture.componentInstance.onPublishRequested(submission());
    fixture.detectChanges();

    expect(emitted).toEqual([]);
    expect(fixture.componentInstance.finalReviewOpen()).toBe(true);
    const review = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="announcement-multi-audience-final-review"]',
    )?.textContent ?? '';
    expect(review).toContain('Teachers');
    expect(review).toContain('Teachers / Announcements');
    expect(review).toContain('21');

    fixture.componentInstance.confirmFinalPublication();

    expect(emitted).toHaveLength(1);
    expect(emitted[0].audience).toEqual(groupAudience);
    expect(emitted[0].audiences).toEqual([groupAudience, channelAudience]);
  });

  it('fails closed for scheduled delivery when selected targets have different organizational time zones', async () => {
    const fixture = await render();
    fixture.componentInstance.toggleAudience(otherZoneAudience.key, true);
    const emitted: AnnouncementEditorSubmission[] = [];
    fixture.componentInstance.publishRequested.subscribe((value) => emitted.push(value));

    fixture.componentInstance.onPublishRequested(
      submission({
        deliveryMode: 'scheduled',
        scheduledLocalDateTime: '2026-09-02T09:00',
        timeZoneId: 'Asia/Tokyo',
      }),
    );

    expect(emitted).toEqual([]);
    expect(fixture.componentInstance.finalReviewOpen()).toBe(false);
    expect(fixture.componentInstance.localError()).toContain('タイムゾーン');
  });

  it('drops a revoked additional target when authorized options refresh', async () => {
    const fixture = await render(
      draft({ audienceKeys: [groupAudience.key, channelAudience.key] }),
    );
    expect(fixture.componentInstance.selectedKeys()).toEqual([
      groupAudience.key,
      channelAudience.key,
    ]);

    fixture.componentRef.setInput(
      'draft',
      draft({
        audienceKeys: [groupAudience.key, channelAudience.key],
        availableAudiences: [groupAudience],
      }),
    );
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedKeys()).toEqual([groupAudience.key]);
    expect(fixture.componentInstance.localError()).toContain('権限');
  });
});
