import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { FrontendApiError } from '../core/api/api-error.model';
import { AppConfirmDialogComponent } from './dialog/app-confirm-dialog/app-confirm-dialog.component';
import { AppEmptyStateComponent } from './empty-state/app-empty-state/app-empty-state.component';
import { AppErrorBannerComponent } from './error/app-error-banner/app-error-banner.component';
import { AppPageLocalSearchComponent, PageLocalSearchRow } from './navigation/app-page-local-search/app-page-local-search.component';
import { AppPermissionDeniedComponent } from './permission/app-permission-denied/app-permission-denied.component';
import { AppSafeNotFoundComponent } from './permission/app-safe-not-found/app-safe-not-found.component';

const normalizedError = (overrides: Partial<FrontendApiError> = {}): FrontendApiError => ({
  code: 'ServerError',
  message: 'Internal failure',
  details: [],
  requestId: 'req-123',
  redactionApplied: true,
  httpStatus: 500,
  localErrorId: 'local-abc',
  ...overrides
});

@Component({
  standalone: true,
  imports: [AppConfirmDialogComponent],
  template: `
    <button #trigger type="button" (click)="open = true">開く</button>
    <app-confirm-dialog
      [open]="open"
      [returnFocusTo]="trigger"
      (cancel)="open = false"
      (confirm)="open = false"
    />
  `
})
class DialogHostComponent {
  open = false;
}

describe('shared safe state components', () => {
  it('PermissionDenied does not render hidden record name', async () => {
    await TestBed.configureTestingModule({
      imports: [AppPermissionDeniedComponent]
    }).compileComponents();

    const fixture = TestBed.createComponent(AppPermissionDeniedComponent);
    fixture.componentRef.setInput('title', 'アクセスできません');
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('この操作を実行する権限がありません。');
    expect(text).not.toContain('非表示レコード-ABC');
  });

  it('SafeNotFound does not reveal existence', async () => {
    await TestBed.configureTestingModule({
      imports: [AppSafeNotFoundComponent]
    }).compileComponents();

    const fixture = TestBed.createComponent(AppSafeNotFoundComponent);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('対象が見つからないか、表示できません。');
    expect(text).not.toContain('存在します');
    expect(text).not.toContain('非表示レコード-XYZ');
  });

  it('ErrorBanner shows backend requestId safely', async () => {
    await TestBed.configureTestingModule({
      imports: [AppErrorBannerComponent]
    }).compileComponents();

    const fixture = TestBed.createComponent(AppErrorBannerComponent);
    fixture.componentRef.setInput(
      'error',
      normalizedError({
        requestId: 'req-safe-001',
        localErrorId: 'local-safe-001',
        details: [{ message: 'at SecretService.run(C:\\internal\\path.ts:1)' }]
      })
    );
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('問題が発生しました。管理者に次のIDを伝えてください: req-safe-001');
    expect(text).toContain('req-safe-001');
    expect(text).not.toContain('local-safe-001');
    expect(text).not.toContain('SecretService');
    expect(text).not.toContain('C:\\internal');
  });

  it('ErrorBanner falls back to localErrorId without implying backend log mapping', async () => {
    await TestBed.configureTestingModule({
      imports: [AppErrorBannerComponent]
    }).compileComponents();

    const fixture = TestBed.createComponent(AppErrorBannerComponent);
    fixture.componentRef.setInput('error', normalizedError({ requestId: undefined, localErrorId: 'local-only-001' }));
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('問題が発生しました。管理者に次のIDを伝えてください: local-only-001');
    expect(text).toContain('ローカルエラーID');
    expect(text).toContain('このIDはこの画面内の識別用です。');
    expect(text).not.toContain('サーバーログ');
  });

  it('Page-local search filters provided rows only', async () => {
    await TestBed.configureTestingModule({
      imports: [AppPageLocalSearchComponent]
    }).compileComponents();

    const fixture = TestBed.createComponent(AppPageLocalSearchComponent);
    const rows: readonly PageLocalSearchRow[] = [
      { id: 'visible-1', searchText: 'サンプル申請 下書き' },
      { id: 'visible-2', searchText: 'サンプル通知 確認済み' }
    ];
    const emitted: Array<readonly PageLocalSearchRow[]> = [];
    fixture.componentRef.setInput('rows', rows);
    fixture.componentInstance.filteredRowsChange.subscribe((value) => emitted.push(value));
    fixture.detectChanges();

    fixture.componentInstance.updateSearch('通知');
    expect(fixture.componentInstance.filteredRows.map((row) => row.id)).toEqual(['visible-2']);

    fixture.componentInstance.updateSearch('非表示レコード');
    expect(fixture.componentInstance.filteredRows).toEqual([]);
    expect(emitted.at(-1)).toEqual([]);
  });

  it('Dialog traps focus and returns focus when closed', async () => {
    await TestBed.configureTestingModule({
      imports: [DialogHostComponent]
    }).compileComponents();

    const fixture = TestBed.createComponent(DialogHostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();

    const trigger = (fixture.nativeElement as HTMLElement).querySelector('button') as HTMLButtonElement;
    trigger.focus();
    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const dialog = (fixture.nativeElement as HTMLElement).querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);

    const cancelButton = Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent?.includes('キャンセル'));
    cancelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    await Promise.resolve();

    expect(document.activeElement).toBe(trigger);
    fixture.destroy();
  });

  it('Icon-only buttons have accessible labels where used', async () => {
    await TestBed.configureTestingModule({
      imports: [AppEmptyStateComponent]
    }).compileComponents();

    const fixture = TestBed.createComponent(AppEmptyStateComponent);
    fixture.componentRef.setInput('actionLabel', '条件を変更');
    fixture.detectChanges();

    const buttons = fixture.debugElement.queryAll(By.css('button'));
    expect(buttons.length).toBe(1);
    for (const button of buttons) {
      const element = button.nativeElement as HTMLButtonElement;
      const accessibleName = element.textContent?.trim() || element.getAttribute('aria-label') || element.getAttribute('title');
      expect(accessibleName).toBeTruthy();
    }
  });
});
