import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';

export type AipTheme = 'dark' | 'light';
export type AipDensity = 'compact' | 'comfortable';

const THEME_STORAGE_KEY = 'aipsite.ui.theme.v1';

@Injectable({ providedIn: 'root' })
export class AipThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly themeValue = signal<AipTheme>(this.initialTheme());
  private readonly densityValue = signal<AipDensity>(this.initialDensity());
  readonly theme = this.themeValue.asReadonly();
  readonly density = this.densityValue.asReadonly();
  readonly isDark = computed(() => this.themeValue() === 'dark');

  constructor() {
    this.apply();
    this.listenForDensityChanges();
  }

  setTheme(theme: AipTheme): void {
    this.themeValue.set(theme);
    this.writeStoredTheme(theme);
    this.apply();
  }

  refreshDensity(): void {
    this.densityValue.set(this.initialDensity());
    this.apply();
  }

  private initialTheme(): AipTheme {
    const stored = this.readStoredTheme();
    if (stored) return stored;
    return this.media('(prefers-color-scheme: light)')?.matches ? 'light' : 'dark';
  }

  private initialDensity(): AipDensity {
    return this.media('(max-width: 860px), (pointer: coarse)')?.matches ? 'comfortable' : 'compact';
  }

  private apply(): void {
    const root = this.document.documentElement;
    root.dataset['aipTheme'] = this.themeValue();
    root.dataset['aipDensity'] = this.densityValue();
  }

  private readStoredTheme(): AipTheme | null {
    try {
      const value = globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
      return value === 'dark' || value === 'light' ? value : null;
    } catch { return null; }
  }

  private writeStoredTheme(theme: AipTheme): void {
    try { globalThis.localStorage?.setItem(THEME_STORAGE_KEY, theme); } catch { /* Storage may be unavailable. */ }
  }

  private media(query: string): MediaQueryList | null {
    return typeof window === 'undefined' || !window.matchMedia ? null : window.matchMedia(query);
  }

  private listenForDensityChanges(): void {
    const media = this.media('(max-width: 860px), (pointer: coarse)');
    media?.addEventListener('change', () => this.refreshDensity());
  }
}
