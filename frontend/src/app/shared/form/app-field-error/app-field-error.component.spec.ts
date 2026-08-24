import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AppFieldErrorComponent } from './app-field-error.component';

describe('AppFieldErrorComponent', () => {
  let fixture: ComponentFixture<AppFieldErrorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AppFieldErrorComponent] }).compileComponents();
    fixture = TestBed.createComponent(AppFieldErrorComponent);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('announces errors from a semantic list without serializing a null id', () => {
    fixture.componentRef.setInput('messages', ['Name is required.']);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const alert = root.querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.tagName).toBe('DIV');
    expect(alert?.hasAttribute('id')).toBe(false);
    expect(alert?.querySelector('ul > li')?.textContent).toContain('Name is required.');
  });

  it('uses an explicit id when a field references the error container', () => {
    fixture.componentRef.setInput('id', 'workspace-name-errors');
    fixture.componentRef.setInput('messages', ['Name is required.']);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]')?.id).toBe('workspace-name-errors');
  });
});
