import { TestBed } from '@angular/core/testing';

import { MessageNavigationStateService } from './message-navigation-state.service';

describe('MessageNavigationStateService', () => {
  let host: HTMLElement | null = null;

  afterEach(() => {
    host?.remove();
    host = null;
    sessionStorage.clear();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  function installScrollHost(initialTop = 0) {
    host = document.createElement('main');
    host.id = 'app-shell-main-content';
    host.scrollTop = initialTop;
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

  function runAnimationFramesImmediately() {
    return vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  }

  it('remembers the actual AppShell content scroll position', () => {
    const { host: scrollHost } = installScrollHost(384);
    const service = TestBed.inject(MessageNavigationStateService);

    service.rememberListScroll();

    expect(scrollHost.scrollTop).toBe(384);
    expect(sessionStorage.getItem('aip.messaging.list-scroll-y.v1')).toBe('384');
    expect(sessionStorage.getItem('aip.messaging.list-scroll-restore-pending.v1')).toBe('1');
  });

  it('restores a remembered AppShell position once after the list is rendered', () => {
    const { host: scrollHost, scrollTo } = installScrollHost(512);
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

  it('does not restore an old position when there is no pending conversation return', () => {
    const { scrollTo } = installScrollHost();
    const service = TestBed.inject(MessageNavigationStateService);
    sessionStorage.setItem('aip.messaging.list-scroll-y.v1', '256');
    runAnimationFramesImmediately();

    service.restoreListScroll();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('drops invalid stored positions instead of attempting to scroll', () => {
    const { scrollTo } = installScrollHost();
    const service = TestBed.inject(MessageNavigationStateService);
    sessionStorage.setItem('aip.messaging.list-scroll-y.v1', 'not-a-position');
    sessionStorage.setItem('aip.messaging.list-scroll-restore-pending.v1', '1');

    service.restoreListScroll();

    expect(sessionStorage.getItem('aip.messaging.list-scroll-y.v1')).toBeNull();
    expect(sessionStorage.getItem('aip.messaging.list-scroll-restore-pending.v1')).toBeNull();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('starts conversation detail at the top of the AppShell scroll container', () => {
    const { host: scrollHost, scrollTo } = installScrollHost(320);
    const service = TestBed.inject(MessageNavigationStateService);
    runAnimationFramesImmediately();

    service.resetDetailScroll();

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' });
    expect(scrollHost.scrollTop).toBe(0);
  });
});
