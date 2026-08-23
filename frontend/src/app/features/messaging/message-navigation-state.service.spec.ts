import { TestBed } from '@angular/core/testing';

import { MessageNavigationStateService } from './message-navigation-state.service';

describe('MessageNavigationStateService', () => {
  let host: HTMLElement | null = null;
  let documentHost: HTMLElement | null = null;
  const originalScrollingElementDescriptor = Object.getOwnPropertyDescriptor(document, 'scrollingElement');

  afterEach(() => {
    host?.remove();
    documentHost?.remove();
    host = null;
    documentHost = null;
    if (originalScrollingElementDescriptor) {
      Object.defineProperty(document, 'scrollingElement', originalScrollingElementDescriptor);
    } else {
      Reflect.deleteProperty(document, 'scrollingElement');
    }
    sessionStorage.clear();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  function installScrollHost(initialTop = 0, scrollable = true) {
    host = document.createElement('main');
    host.id = 'app-shell-main-content';
    host.scrollTop = initialTop;
    Object.defineProperty(host, 'scrollHeight', {
      configurable: true,
      value: scrollable ? 1200 : 400,
    });
    Object.defineProperty(host, 'clientHeight', {
      configurable: true,
      value: 400,
    });
    const scrollTo = vi.fn((options: ScrollToOptions) => {
      host!.scrollTop = Number(options.top ?? 0);
    });
    Object.defineProperty(host, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    });
    document.body.append(host);
    return { host, scrollTo };
  }

  function installDocumentScrollHost(initialTop = 0, scrollable = true) {
    documentHost = document.createElement('div');
    documentHost.scrollTop = initialTop;
    Object.defineProperty(documentHost, 'scrollHeight', {
      configurable: true,
      value: scrollable ? 1600 : 400,
    });
    Object.defineProperty(documentHost, 'clientHeight', {
      configurable: true,
      value: 400,
    });
    const scrollTo = vi.fn((options: ScrollToOptions) => {
      documentHost!.scrollTop = Number(options.top ?? 0);
    });
    Object.defineProperty(documentHost, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    });
    Object.defineProperty(document, 'scrollingElement', {
      configurable: true,
      get: () => documentHost,
    });
    return { host: documentHost, scrollTo };
  }

  function runAnimationFramesImmediately() {
    return vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  }

  it('remembers a scrollable AppShell content position', () => {
    const { host: scrollHost } = installScrollHost(384);
    installDocumentScrollHost(0, false);
    const service = TestBed.inject(MessageNavigationStateService);

    service.rememberListScroll();

    expect(scrollHost.scrollTop).toBe(384);
    expect(sessionStorage.getItem('aip.messaging.list-scroll-y.v1')).toBe('384');
    expect(sessionStorage.getItem('aip.messaging.list-scroll-restore-pending.v1')).toBe('1');
  });

  it('uses the document scroll root when AppShell content expands instead of overflowing', () => {
    installScrollHost(0, false);
    const { host: pageScroll } = installDocumentScrollHost(420);
    const service = TestBed.inject(MessageNavigationStateService);

    service.rememberListScroll();

    expect(pageScroll.scrollTop).toBe(420);
    expect(sessionStorage.getItem('aip.messaging.list-scroll-y.v1')).toBe('420');
    expect(sessionStorage.getItem('aip.messaging.list-scroll-restore-pending.v1')).toBe('1');
  });

  it('restores a remembered AppShell position once after the list is rendered', () => {
    const { host: scrollHost, scrollTo } = installScrollHost(512);
    installDocumentScrollHost(0, false);
    const service = TestBed.inject(MessageNavigationStateService);
    service.rememberListScroll();
    scrollHost.scrollTop = 0;
    runAnimationFramesImmediately();

    service.restoreListScroll();

    expect(scrollTo).toHaveBeenCalledWith({ top: 512, left: 0, behavior: 'auto' });
    expect(scrollHost.scrollTop).toBe(512);
    expect(sessionStorage.getItem('aip.messaging.list-scroll-y.v1')).toBeNull();
    expect(sessionStorage.getItem('aip.messaging.list-scroll-restore-pending.v1')).toBeNull();
  });

  it('restores a remembered document position once when it is the effective scroll root', () => {
    installScrollHost(0, false);
    const { host: pageScroll, scrollTo } = installDocumentScrollHost(480);
    const service = TestBed.inject(MessageNavigationStateService);
    service.rememberListScroll();
    pageScroll.scrollTop = 0;
    runAnimationFramesImmediately();

    service.restoreListScroll();

    expect(scrollTo).toHaveBeenCalledWith({ top: 480, left: 0, behavior: 'auto' });
    expect(pageScroll.scrollTop).toBe(480);
    expect(sessionStorage.getItem('aip.messaging.list-scroll-y.v1')).toBeNull();
    expect(sessionStorage.getItem('aip.messaging.list-scroll-restore-pending.v1')).toBeNull();
  });

  it('does not restore an old position when there is no pending conversation return', () => {
    const { scrollTo } = installScrollHost();
    installDocumentScrollHost(0, false);
    const service = TestBed.inject(MessageNavigationStateService);
    sessionStorage.setItem('aip.messaging.list-scroll-y.v1', '256');
    runAnimationFramesImmediately();

    service.restoreListScroll();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('drops invalid stored positions instead of attempting to scroll', () => {
    const { scrollTo } = installScrollHost();
    installDocumentScrollHost(0, false);
    const service = TestBed.inject(MessageNavigationStateService);
    sessionStorage.setItem('aip.messaging.list-scroll-y.v1', 'not-a-position');
    sessionStorage.setItem('aip.messaging.list-scroll-restore-pending.v1', '1');

    service.restoreListScroll();

    expect(sessionStorage.getItem('aip.messaging.list-scroll-y.v1')).toBeNull();
    expect(sessionStorage.getItem('aip.messaging.list-scroll-restore-pending.v1')).toBeNull();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('starts conversation detail at the top of both possible scroll roots', () => {
    const { host: scrollHost, scrollTo: appScrollTo } = installScrollHost(320);
    const { host: pageScroll, scrollTo: pageScrollTo } = installDocumentScrollHost(240);
    const service = TestBed.inject(MessageNavigationStateService);
    runAnimationFramesImmediately();

    service.resetDetailScroll();

    expect(appScrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' });
    expect(pageScrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' });
    expect(scrollHost.scrollTop).toBe(0);
    expect(pageScroll.scrollTop).toBe(0);
  });
});
