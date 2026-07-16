import { TestBed } from '@angular/core/testing';

import { AipThemeService } from './aip-theme.service';

describe('AipThemeService', () => {
  const originalMatchMedia = window.matchMedia;
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-aip-theme');
    document.documentElement.removeAttribute('data-aip-density');
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
  });

  function setMedia(matches: boolean): void {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches, addEventListener: vi.fn() })
    });
  }

  it('uses dark as the default and exposes it on the root', () => {
    const service = TestBed.inject(AipThemeService);
    expect(service.theme()).toBe('dark');
    expect(document.documentElement.dataset['aipTheme']).toBe('dark');
  });

  it('uses OS light preference before an explicit choice', () => {
    setMedia(true);
    const service = TestBed.inject(AipThemeService);
    expect(service.theme()).toBe('light');
  });

  it('uses an explicit local preference over OS preference and ignores invalid values', () => {
    localStorage.setItem('aipsite.ui.theme.v1', 'dark');
    setMedia(true);
    expect(TestBed.inject(AipThemeService).theme()).toBe('dark');

    TestBed.resetTestingModule();
    localStorage.setItem('aipsite.ui.theme.v1', 'invalid');
    TestBed.configureTestingModule({});
    expect(TestBed.inject(AipThemeService).theme()).toBe('light');
  });

  it('switches theme and density without navigation', () => {
    setMedia(true);
    const service = TestBed.inject(AipThemeService);
    const path = location.pathname;
    service.setTheme('light');
    expect(localStorage.getItem('aipsite.ui.theme.v1')).toBe('light');
    expect(document.documentElement.dataset['aipTheme']).toBe('light');
    expect(service.density()).toBe('comfortable');
    expect(location.pathname).toBe(path);
  });
});
