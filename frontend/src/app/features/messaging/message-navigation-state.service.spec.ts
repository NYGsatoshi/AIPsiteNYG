import { TestBed } from '@angular/core/testing';

import { MessageNavigationStateService } from './message-navigation-state.service';

describe('MessageNavigationStateService', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('remembers the current messages list scroll position', () => {
    const service = TestBed.inject(MessageNavigationStateService);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(384);

    service.rememberListScroll();

    expect(sessionStorage.getItem('aip.messaging.list-scroll-y.v1')).toBe('384');
  });

  it('restores a remembered position after the list is rendered', () => {
    const service = TestBed.inject(MessageNavigationStateService);
    sessionStorage.setItem('aip.messaging.list-scroll-y.v1', '512');
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(512);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    service.restoreListScroll();

    expect(scrollTo).toHaveBeenCalledWith({ top: 512, left: 0, behavior: 'auto' });
  });

  it('drops invalid stored positions instead of attempting to scroll', () => {
    const service = TestBed.inject(MessageNavigationStateService);
    sessionStorage.setItem('aip.messaging.list-scroll-y.v1', 'not-a-position');
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);

    service.restoreListScroll();

    expect(sessionStorage.getItem('aip.messaging.list-scroll-y.v1')).toBeNull();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
