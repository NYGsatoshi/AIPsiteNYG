import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, EventEmitter, Input, OnChanges, Output, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { Subject, of } from 'rxjs';

import { TaskMentionCandidateDto } from '../../features/projects/projects.api';

interface MentionToken { readonly userId: string; readonly displayName: string; readonly start: number; readonly end: number; }

let mentionInputInstance = 0;

/**
 * AIPsite-owned token editor. The textarea contains friendly display text while
 * the emitted value always re-encodes selected people as @{canonical-guid}.
 */
@Component({
  selector: 'app-mention-input', standalone: true,
  template: `<label [for]="textareaId">Comment</label>
  <textarea #editor [id]="textareaId" [value]="displayValue()" (input)="onInput($event)" (keydown)="onKeydown($event)"
    [attr.aria-describedby]="statusId" aria-autocomplete="list" [attr.aria-expanded]="candidates().length > 0"
    [attr.aria-controls]="listboxId" [attr.aria-activedescendant]="activeOptionId()"></textarea>
  @if (candidates().length) { <ul [id]="listboxId" role="listbox" aria-label="Mention candidates">
    @for (candidate of candidates(); track candidate.userId; let i = $index) { <li [id]="optionId(i)" role="option" [attr.aria-selected]="i === selectedIndex()"><button type="button" (click)="select(candidate)">@{{ candidate.displayName }}</button></li> }
  </ul> }
  <p [id]="statusId" role="status" aria-live="polite">{{ status() }}</p>`,
  styles: [':host{display:grid;gap:.5rem}textarea{min-height:5rem}ul{margin:0;padding:0;list-style:none}button{width:100%;text-align:left}']
})
export class AppMentionInputComponent implements OnChanges {
  @Input({ required: true }) taskId = '';
  @Input() value = '';
  @Input() inputId?: string;
  @Input() knownMentions: readonly { userId: string; displayName: string }[] = [];
  @Output() valueChange = new EventEmitter<string>();
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly query = new Subject<string>();
  private readonly instance = ++mentionInputInstance;
  private tokens: readonly MentionToken[] = [];
  private lastCanonical = '';
  readonly candidates = signal<readonly { userId: string; displayName: string }[]>([]);
  readonly selectedIndex = signal(0);
  readonly status = signal('');
  readonly displayValue = signal('');

  get textareaId(): string { return this.inputId || `mention-input-${this.instance}`; }
  get listboxId(): string { return `${this.textareaId}-candidates`; }
  get statusId(): string { return `${this.textareaId}-status`; }

  constructor() {
    this.query.pipe(debounceTime(200), distinctUntilChanged(), switchMap(text => {
      if (!text) { this.status.set(''); return of([] as readonly TaskMentionCandidateDto[]); }
      this.status.set('Loading mention candidates…');
      return this.http.get<readonly TaskMentionCandidateDto[]>(`/api/tasks/${this.taskId}/mention-candidates?query=${encodeURIComponent(text)}&limit=10`, { withCredentials: true }).pipe(catchError((error: unknown) => {
        this.status.set((error as { status?: number })?.status === 403 ? 'Mention search is not permitted.' : 'Mention search failed.');
        return of([] as readonly TaskMentionCandidateDto[]);
      }));
    }), takeUntilDestroyed(this.destroyRef)).subscribe(results => {
      const candidates = results.map(result => ({ userId: typeof result.userId === 'string' ? result.userId : '', displayName: typeof result.displayName === 'string' ? result.displayName : '' })).filter(result => result.userId && result.displayName);
      this.candidates.set(candidates); this.selectedIndex.set(0);
      this.status.set(candidates.length ? `${candidates.length} mention candidates available.` : 'No mention candidates found.');
    });
  }

  ngOnChanges(): void {
    if (this.value === this.lastCanonical) return;
    const names = new Map(this.knownMentions.map(mention => [mention.userId, mention.displayName]));
    const tokens: MentionToken[] = [];
    const pattern = /@\{(?<id>[0-9a-fA-F-]{36})\}/g;
    let display = ''; let canonicalCursor = 0; let match: RegExpExecArray | null;
    while ((match = pattern.exec(this.value)) !== null) {
      display += this.value.slice(canonicalCursor, match.index);
      const userId = match.groups?.['id'] ?? '';
      const displayName = names.get(userId) ?? 'Mention';
      const text = `@${displayName}`;
      tokens.push({ userId, displayName, start: display.length, end: display.length + text.length });
      display += text; canonicalCursor = match.index + match[0].length;
    }
    display += this.value.slice(canonicalCursor);
    this.tokens = tokens;
    this.displayValue.set(display); this.lastCanonical = this.value;
  }

  onInput(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    const next = textarea.value;
    this.tokens = this.retainTokens(this.displayValue(), next);
    this.displayValue.set(next);
    this.emitCanonical();
    const beforeCursor = next.slice(0, textarea.selectionStart ?? next.length);
    const match = /@([\p{L}\p{N} .'-]*)$/u.exec(beforeCursor);
    this.query.next(match?.[1]?.trim() ?? '');
  }

  activeOptionId(): string | null { return this.candidates().length ? this.optionId(this.selectedIndex()) : null; }
  optionId(index: number): string { return `${this.textareaId}-mention-${index}`; }
  onKeydown(event: KeyboardEvent): void {
    if (!this.candidates().length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); this.selectedIndex.update(index => Math.min(index + 1, this.candidates().length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); this.selectedIndex.update(index => Math.max(index - 1, 0)); }
    else if (event.key === 'Enter') { event.preventDefault(); this.select(this.candidates()[this.selectedIndex()]); }
    else if (event.key === 'Escape') { event.preventDefault(); this.candidates.set([]); this.status.set('Mention suggestions closed.'); }
  }

  select(candidate: { userId: string; displayName: string }): void {
    const value = this.displayValue();
    const match = /@([\p{L}\p{N} .'-]*)$/u.exec(value);
    if (!candidate || !match || match.index === undefined) return;
    const start = match.index; const text = `@${candidate.displayName}`;
    const next = `${value.slice(0, start)}${text}${value.slice(start + match[0].length)}`;
    const delta = text.length - match[0].length;
    this.tokens = [...this.tokens.filter(token => token.end <= start || token.start >= start + match[0].length).map(token => token.start >= start ? { ...token, start: token.start + delta, end: token.end + delta } : token), { userId: candidate.userId, displayName: candidate.displayName, start, end: start + text.length }].sort((a, b) => a.start - b.start);
    this.displayValue.set(next); this.emitCanonical(); this.candidates.set([]); this.status.set(`Mentioned @${candidate.displayName}.`);
  }

  private retainTokens(previous: string, next: string): readonly MentionToken[] {
    let prefix = 0; while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix++;
    let suffix = 0; while (suffix < previous.length - prefix && suffix < next.length - prefix && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
    const oldEnd = previous.length - suffix; const newEnd = next.length - suffix; const delta = newEnd - oldEnd;
    return this.tokens.flatMap(token => token.end <= prefix ? [token] : token.start >= oldEnd ? [{ ...token, start: token.start + delta, end: token.end + delta }] : []);
  }

  private emitCanonical(): void {
    const display = this.displayValue(); let cursor = 0; let canonical = '';
    for (const token of this.tokens) { canonical += display.slice(cursor, token.start) + `@{${token.userId}}`; cursor = token.end; }
    canonical += display.slice(cursor); this.lastCanonical = canonical; this.valueChange.emit(canonical);
  }
}
