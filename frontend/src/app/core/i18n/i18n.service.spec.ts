import { TestBed } from '@angular/core/testing';

import { I18nService } from './i18n.service';

describe('I18nService', () => {
  beforeEach(() => {
    window.localStorage.removeItem('aip.locale');
  });

  afterEach(() => {
    window.localStorage.removeItem('aip.locale');
    TestBed.resetTestingModule();
  });

  it('uses Japanese by default and persists an explicit English selection', () => {
    const service = TestBed.inject(I18nService);
    TestBed.tick();

    expect(service.locale()).toBe('ja');
    expect(service.translate('account.eyebrow')).toBe('アカウント');
    expect(document.documentElement.lang).toBe('ja');

    service.setLocale('en');
    TestBed.tick();

    expect(service.translate('account.eyebrow')).toBe('Account');
    expect(document.documentElement.lang).toBe('en');
    expect(window.localStorage.getItem('aip.locale')).toBe('en');
  });

  it('restores a previously saved language preference', () => {
    window.localStorage.setItem('aip.locale', 'en');

    const service = TestBed.inject(I18nService);
    TestBed.tick();

    expect(service.locale()).toBe('en');
    expect(service.translate('login.title')).toBe('Sign in');
  });
});
