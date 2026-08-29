import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { WorkspaceSearchComponent } from './workspace-search.component';

const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const FILE_ID = '44444444-4444-4444-8444-444444444444';

describe('WorkspaceSearchComponent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  async function createFixture(workspaceId: string | null = WORKSPACE_A) {
    await TestBed.configureTestingModule({
      imports: [WorkspaceSearchComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(WorkspaceSearchComponent);
    fixture.componentRef.setInput('workspaceId', workspaceId);
    fixture.componentRef.setInput('workspaceLabel', workspaceId ? 'Workspace A' : '');
    fixture.detectChanges();
    return fixture;
  }

  it('keeps the search entry disabled until a Workspace is selected', async () => {
    const fixture = await createFixture(null);
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector<HTMLInputElement>('[data-testid="workspace-search-input"]');

    expect(input?.disabled).toBe(true);
    expect(input?.getAttribute('aria-controls')).toBeNull();
    expect(root.textContent).toContain('Select a Workspace to search');
  });

  it('queries only Project and File in the active Workspace and rejects mismatched result scopes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        items: [
          {
            type: 7,
            id: PROJECT_ID,
            title: 'Authorized Research',
            workspaceId: WORKSPACE_A,
            createdAt: '2026-08-28T00:00:00Z',
          },
          {
            type: 7,
            id: '55555555-5555-4555-8555-555555555555',
            title: 'Wrong Workspace',
            workspaceId: WORKSPACE_B,
            createdAt: '2026-08-28T00:01:00Z',
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        items: [
          {
            type: 'File',
            id: FILE_ID,
            title: 'authorized.pdf',
            workspaceId: WORKSPACE_A,
            createdAt: '2026-08-28T00:02:00Z',
          },
        ],
      }));
    vi.stubGlobal('fetch', fetchMock);

    const fixture = await createFixture();
    const component = fixture.componentInstance;
    component.query.set('needle');
    component.submitSearch(new Event('submit', { cancelable: true }));

    await vi.waitFor(() => expect(component.status()).toBe('ready'));
    fixture.detectChanges();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requestedTypes = new Set<string>();
    for (const [input, init] of fetchMock.mock.calls) {
      const url = new URL(String(input), 'https://aip.test');
      requestedTypes.add(url.searchParams.get('type') ?? '');
      expect(url.pathname).toBe('/api/search');
      expect(url.searchParams.get('q')).toBe('needle');
      expect(url.searchParams.get('workspaceId')).toBe(WORKSPACE_A);
      expect(url.searchParams.get('page')).toBe('1');
      expect(url.searchParams.get('pageSize')).toBe('8');
      expect(init).toMatchObject({ method: 'GET', credentials: 'include' });
    }
    expect(requestedTypes).toEqual(new Set(['Project', 'File']));

    const root = fixture.nativeElement as HTMLElement;
    const text = root.textContent ?? '';
    expect(text).toContain('Authorized Research');
    expect(text).toContain('authorized.pdf');
    expect(text).toContain('Research / Project');
    expect(text).toContain('File');
    expect(text).not.toContain('Wrong Workspace');
    expect(text).not.toContain('snippet');
    expect(component.results().length).toBe(2);
    expect(root.querySelector('[data-testid="workspace-search-results"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="workspace-search-input"]')?.getAttribute('aria-controls')).toBe(
      'workspace-search-results',
    );
  });

  it('cancels stale reads and clears protected results when the Workspace changes', async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal;
      signals.push(signal);
      return pendingUntilAborted(signal);
    });
    vi.stubGlobal('fetch', fetchMock);

    const fixture = await createFixture();
    const component = fixture.componentInstance;
    component.query.set('needle');
    component.submitSearch(new Event('submit', { cancelable: true }));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fixture.componentRef.setInput('workspaceId', WORKSPACE_B);
    fixture.componentRef.setInput('workspaceLabel', 'Workspace B');
    fixture.detectChanges();

    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(component.query()).toBe('');
    expect(component.results()).toEqual([]);
    expect(component.status()).toBe('idle');
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('[data-testid="workspace-search-input"]')
        ?.getAttribute('aria-controls'),
    ).toBeNull();
  });

  it('renders a fixed retry-safe error without exposing a response body', async () => {
    let secondSignal: AbortSignal | null = null;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ detail: 'secret stack and internal filename' }, false))
      .mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => {
        secondSignal = init?.signal as AbortSignal;
        return pendingUntilAborted(secondSignal);
      });
    vi.stubGlobal('fetch', fetchMock);

    const fixture = await createFixture();
    const component = fixture.componentInstance;
    component.query.set('needle');
    component.submitSearch(new Event('submit', { cancelable: true }));

    await vi.waitFor(() => expect(component.status()).toBe('error'));
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Search is unavailable. Try again.');
    expect(text).not.toContain('secret stack');
    expect(text).not.toContain('internal filename');
    expect(secondSignal?.aborted).toBe(true);
  });

  it('focuses the visible Workspace search field with Ctrl+K', async () => {
    const fixture = await createFixture();
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'k',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(document.activeElement).toBe(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="workspace-search-input"]'),
    );
    fixture.destroy();
  });
});

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

function pendingUntilAborted(signal: AbortSignal): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
}
