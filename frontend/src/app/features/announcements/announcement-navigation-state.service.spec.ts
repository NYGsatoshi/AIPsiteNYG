import { TestBed } from '@angular/core/testing';

import { AnnouncementNavigationStateService } from './announcement-navigation-state.service';

describe('AnnouncementNavigationStateService', () => {
  let appScrollHost: HTMLElement | null = null;
  let documentScrollHost: HTMLElement | null = null;
  let documentScrollingElementDescriptor: PropertyDescriptor | undefined;
  let documentScrollTopDescriptor: PropertyDescriptor | undefined;
  let documentScrollToDescriptor: PropertyDescriptor | undefined;
  const originalMatchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');

  afterEach(() => {
    appScrollHost?.remove();
    appScrollHost = null;
    if (documentScrollingElementDescriptor) {
      Object.defineProperty(document, 'scrollingElement', documentScrollingElementDescriptor);
    } else {
      Reflect.deleteProperty(document, 'scrollingElement');
    }
    if (documentScrollHost) {
      if (documentScrollTopDescriptor) {
        Object.defineProperty(documentScrollHost, 'scrollTop', documentScrollTopDescriptor);
      } else {
        Reflect.deleteProperty(documentScrollHost, 'scrollTop');
      }
      if (documentScrollToDescriptor) {
        Object.defineProperty(documentScrollHost, 'scrollTo', documentScrollToDescriptor);
      } else {
        Reflect.deleteProperty(documentScrollHost, 'scrollTo');
      }
    }
    documentScrollHost = null;
    documentScrollingElementDescriptor = undefined;
    documentScrollTopDescriptor = undefined;
    documentScrollToDescriptor = undefined;
    if (originalMatchMediaDescriptor) {
      Object.defineProperty(window, 'matchMedia', originalMatchMediaDescriptor);
    } else {
      Reflect.deleteProperty(window, 'matchMedia');
    }
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  function setMobileHierarchy(matches: boolean): void {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) =>
        ({
          matches: query === '(max-width: 860px)' && matches,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(() => true),
        }) as MediaQueryList,
    });
  }

  function runAnimationFramesImmediately(): void {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  }

  function installAppScrollHost(initialTop: number, updatesPosition = true): ReturnType<typeof vi.fn> {
    appScrollHost = document.createElement('main');
    appScrollHost.id = 'app-shell-main-content';
    appScrollHost.scrollTop = initialTop;
    const scrollTo = vi.fn((options: ScrollToOptions) => {
      if (updatesPosition) {
        appScrollHost!.scrollTop = Number(options.top ?? 0);
      }
    });
    Object.defineProperty(appScrollHost, 'scrollTo', { configurable: true, value: scrollTo });
    document.body.append(appScrollHost);
    return scrollTo;
  }

  function installDocumentScrollHost(initialTop: number): ReturnType<typeof vi.fn> {
    documentScrollingElementDescriptor = Object.getOwnPropertyDescriptor(document, 'scrollingElement');
    documentScrollHost = document.documentElement;
    Object.defineProperty(document, 'scrollingElement', {
      configurable: true,
      get: () => documentScrollHost,
    });
    documentScrollTopDescriptor = Object.getOwnPropertyDescriptor(documentScrollHost, 'scrollTop');
    documentScrollToDescriptor = Object.getOwnPropertyDescriptor(documentScrollHost, 'scrollTo');
    Object.defineProperty(documentScrollHost, 'scrollTop', {
      configurable: true,
      writable: true,
      value: initialTop,
    });
    const scrollTo = vi.fn((options: ScrollToOptions) => {
      documentScrollHost!.scrollTop = Number(options.top ?? 0);
    });
    Object.defineProperty(documentScrollHost, 'scrollTo', { configurable: true, value: scrollTo });
    return scrollTo;
  }

  it('resets the AppShell scroll host for mobile detail, then restores it before returning focus', () => {
    const scrollTo = installAppScrollHost(384);
    setMobileHierarchy(true);
    runAnimationFramesImmediately();
    const service = TestBed.inject(AnnouncementNavigationStateService);

    service.rememberListState('announcement-1');
    let resetCompleted = false;
    service.resetDetailScroll(() => {
      resetCompleted = true;
    });

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' });
    expect(appScrollHost?.scrollTop).toBe(0);
    expect(resetCompleted).toBe(true);

    let returnedAnnouncementId: string | null | undefined;
    service.restoreListState((announcementId) => {
      returnedAnnouncementId = announcementId;
      expect(appScrollHost?.scrollTop).toBe(384);
    });

    expect(scrollTo).toHaveBeenLastCalledWith({ top: 384, left: 0, behavior: 'auto' });
    expect(returnedAnnouncementId).toBe('announcement-1');
  });

  it('captures and restores the document root when it is the actual mobile scroll surface', () => {
    installAppScrollHost(0);
    const documentScrollTo = installDocumentScrollHost(160);
    setMobileHierarchy(true);
    runAnimationFramesImmediately();
    const service = TestBed.inject(AnnouncementNavigationStateService);

    service.rememberListState('announcement-document-scroll');
    service.resetDetailScroll(() => undefined);
    expect(documentScrollHost?.scrollTop).toBe(0);

    let returnedAnnouncementId: string | null | undefined;
    service.restoreListState((announcementId) => {
      returnedAnnouncementId = announcementId;
      expect(documentScrollHost?.scrollTop).toBe(160);
    });

    expect(documentScrollTo).toHaveBeenLastCalledWith({ top: 160, left: 0, behavior: 'auto' });
    expect(returnedAnnouncementId).toBe('announcement-document-scroll');
  });

  it('falls back after bounded restore attempts instead of withholding list focus forever', () => {
    const scrollTo = installAppScrollHost(256, false);
    setMobileHierarchy(true);
    runAnimationFramesImmediately();
    const service = TestBed.inject(AnnouncementNavigationStateService);
    service.rememberListState('announcement-2');
    appScrollHost!.scrollTop = 0;

    let returnedAnnouncementId: string | null | undefined;
    service.restoreListState((announcementId) => {
      returnedAnnouncementId = announcementId;
    });

    expect(scrollTo).toHaveBeenCalledTimes(8);
    expect(returnedAnnouncementId).toBe('announcement-2');
  });

  it('returns a heading fallback for a direct detail link without a list origin', () => {
    installAppScrollHost(0);
    setMobileHierarchy(true);
    runAnimationFramesImmediately();
    const service = TestBed.inject(AnnouncementNavigationStateService);
    service.rememberListHeadingFallback();

    let returnedAnnouncementId: string | null | undefined;
    service.restoreListState((announcementId) => {
      returnedAnnouncementId = announcementId;
    });

    expect(returnedAnnouncementId).toBeNull();
  });
});
