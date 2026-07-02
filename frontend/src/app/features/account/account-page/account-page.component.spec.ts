import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AIP_ACCOUNT_MOCK } from '../account.facade';
import { ACCOUNT_MOCK_SCENARIOS } from '../account.mock';
import { AccountMockScenario } from '../account.types';
import { AccountPageComponent } from './account-page.component';

const renderAccount = async (
  scenario: AccountMockScenario = ACCOUNT_MOCK_SCENARIOS.default
): Promise<ComponentFixture<AccountPageComponent>> => {
  await TestBed.configureTestingModule({
    imports: [AccountPageComponent],
    providers: [{ provide: AIP_ACCOUNT_MOCK, useValue: scenario }]
  }).compileComponents();

  const fixture = TestBed.createComponent(AccountPageComponent);
  fixture.detectChanges();
  return fixture;
};

const textContent = (fixture: ComponentFixture<AccountPageComponent>): string =>
  (fixture.nativeElement as HTMLElement).textContent ?? '';

const query = <T extends HTMLElement>(fixture: ComponentFixture<AccountPageComponent>, selector: string): T | null =>
  (fixture.nativeElement as HTMLElement).querySelector<T>(selector);

const updateInput = (fixture: ComponentFixture<AccountPageComponent>, selector: string, value: string): void => {
  const input = query<HTMLInputElement>(fixture, selector);
  if (!input) {
    throw new Error(`Missing input ${selector}`);
  }

  input.value = value;
  input.dispatchEvent(new Event('input'));
};

describe('AccountPageComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders own email on the self account page', async () => {
    const fixture = await renderAccount();

    expect(query(fixture, '[data-testid="own-email"]')?.textContent).toContain('self.account@example.test');
  });

  it('does not render other users email addresses', async () => {
    const fixture = await renderAccount();

    expect(textContent(fixture)).not.toContain('other.member@example.test');
    expect(textContent(fixture)).not.toContain('hidden.other@example.test');
  });

  it('does not render session secrets or tokens', async () => {
    const fixture = await renderAccount();

    expect(textContent(fixture)).not.toContain('mock-refresh-token-should-not-render');
    expect(textContent(fixture)).not.toContain('mock-auth-cookie-should-not-render');
    expect(textContent(fixture)).not.toContain('mock-device-fingerprint-should-not-render');
    expect(textContent(fixture)).not.toContain('203.0.113.10');
  });

  it('does not trim password values in the submit model', async () => {
    const fixture = await renderAccount();

    updateInput(fixture, '[data-testid="current-password"]', ' current password ');
    updateInput(fixture, '[data-testid="new-password"]', ' new password ');
    updateInput(fixture, '[data-testid="confirm-new-password"]', ' new password ');
    query<HTMLButtonElement>(fixture, 'button[type="submit"]')?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.lastPasswordSubmit()).toEqual({
      currentPassword: ' current password ',
      newPassword: ' new password ',
      confirmNewPassword: ' new password '
    });
  });

  it('blocks submit when confirm password does not match', async () => {
    const fixture = await renderAccount();

    updateInput(fixture, '[data-testid="current-password"]', 'current');
    updateInput(fixture, '[data-testid="new-password"]', 'new-one');
    updateInput(fixture, '[data-testid="confirm-new-password"]', 'new-two');
    query<HTMLButtonElement>(fixture, 'button[type="submit"]')?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.lastPasswordSubmit()).toBeNull();
    expect(textContent(fixture)).toContain('新しいパスワードが一致しません。');
  });

  it('hides revoke action when capability is absent', async () => {
    const fixture = await renderAccount(ACCOUNT_MOCK_SCENARIOS.sessionRevokeUnavailable);

    expect(textContent(fixture)).toContain('このセッションを終了');
    expect(query<HTMLButtonElement>(fixture, '.sessions__revoke')).toBeNull();
    expect(query(fixture, '[data-testid="session-revoke-unavailable"]')).not.toBeNull();
  });

  it('mobile layout does not expose hidden actions', async () => {
    const fixture = await renderAccount(ACCOUNT_MOCK_SCENARIOS.sessionRevokeUnavailable);

    (fixture.nativeElement as HTMLElement).style.width = '320px';
    fixture.detectChanges();

    expect(query<HTMLButtonElement>(fixture, '.sessions__revoke')).toBeNull();
    expect(textContent(fixture)).not.toContain('mock-token-never-render');
  });
});
