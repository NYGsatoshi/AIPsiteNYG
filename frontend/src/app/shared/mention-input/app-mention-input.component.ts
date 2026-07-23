import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, EventEmitter, Input, OnChanges, Output, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { Subject, of } from 'rxjs';

import { TaskMentionCandidateDto } from '../../features/projects/projects.api';

/** AIPsite-owned mention authoring control. It stores canonical mention IDs only in the encoded value. */
@Component({
  selector: 'app-mention-input', standalone: true,
  template: `<label [for]="inputId">Comment</label><textarea [id]="inputId" [value]="displayValue()" (input)="onInput($event)" (keydown)="onKeydown($event)" aria-describedby="mention-status"></textarea>
  @if (candidates().length) { <ul role="listbox" aria-label="Mention candidates">@for (candidate of candidates(); track candidate.userId; let i = $index) { <li><button type="button" [attr.aria-selected]="i === selectedIndex()" (click)="select(candidate)">@{{ candidate.displayName }}</button></li>}</ul> }
  <p id="mention-status" role="status">{{ status() }}</p>`,
  styles: [':host{display:grid;gap:.5rem}textarea{min-height:5rem}ul{margin:0;padding:0;list-style:none}button{width:100%;text-align:left}']
})
export class AppMentionInputComponent implements OnChanges {
  @Input({ required: true }) taskId = '';
  @Input() value = '';
  @Input() inputId = 'task-comment-body';
  @Output() valueChange = new EventEmitter<string>();
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly query = new Subject<string>();
  readonly candidates = signal<readonly { userId: string; displayName: string }[]>([]);
  readonly selectedIndex = signal(0);
  readonly status = signal('');
  readonly displayValue = signal('');

  constructor() {
    this.query.pipe(debounceTime(200), distinctUntilChanged(), switchMap(text => {
      if (!text) { this.status.set(''); return of([] as readonly TaskMentionCandidateDto[]); }
      this.status.set('Loading mention candidates…');
      return this.http.get<readonly TaskMentionCandidateDto[]>(`/api/tasks/${this.taskId}/mention-candidates?query=${encodeURIComponent(text)}&limit=10`, { withCredentials: true });
    }), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: results => { const candidates = results.map(result => ({ userId: typeof result.userId === 'string' ? result.userId : '', displayName: typeof result.displayName === 'string' ? result.displayName : '' })).filter(result => result.userId && result.displayName); this.candidates.set(candidates); this.selectedIndex.set(0); this.status.set(candidates.length ? `${candidates.length} mention candidates available.` : 'No mention candidates found.'); },
      error: error => { this.candidates.set([]); this.status.set(error?.status === 403 ? 'Mention search is not permitted.' : 'Mention search failed.'); }
    });
  }
  ngOnChanges(): void { if (!/@\{[0-9a-fA-F-]{36}\}/.test(this.value)) this.displayValue.set(this.value); }
  onInput(event: Event): void { const value = (event.target as HTMLTextAreaElement).value; this.displayValue.set(value); this.valueChange.emit(value); const match = /@([\p{L}\p{N} .'-]*)$/u.exec(value); this.query.next(match?.[1]?.trim() ?? ''); }
  onKeydown(event: KeyboardEvent): void { if (!this.candidates().length) return; if (event.key === 'ArrowDown') { event.preventDefault(); this.selectedIndex.update(index => Math.min(index + 1, this.candidates().length - 1)); } else if (event.key === 'ArrowUp') { event.preventDefault(); this.selectedIndex.update(index => Math.max(index - 1, 0)); } else if (event.key === 'Enter') { event.preventDefault(); this.select(this.candidates()[this.selectedIndex()]); } else if (event.key === 'Escape') { this.candidates.set([]); } }
  select(candidate: { userId: string; displayName: string }): void { if (!candidate) return; const encoded = this.displayValue().replace(/@[\p{L}\p{N} .'-]*$/u, `@{${candidate.userId}}`); this.displayValue.set(this.displayValue().replace(/@[\p{L}\p{N} .'-]*$/u, `@${candidate.displayName}`)); this.valueChange.emit(encoded); this.candidates.set([]); this.status.set(`Mentioned @${candidate.displayName}.`); }
}
