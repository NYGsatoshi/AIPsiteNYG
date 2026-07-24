import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { TaskEditorComponent } from './task-editor.component';

describe('TaskEditorComponent conflict recovery outputs', () => {
  let fixture: ComponentFixture<TaskEditorComponent>;
  let component: TaskEditorComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TaskEditorComponent] });
    fixture = TestBed.createComponent(TaskEditorComponent);
    component = fixture.componentInstance;
    component.task = { id: 'task-1', projectId: 'project-1', title: 'Current', description: '', status: 'notStarted', statusLabel: 'Not started', priority: 'medium', priorityLabel: 'Medium', assignee: '', startDate: '', dueDate: '', progressPercent: 0, milestone: '', allowedTransitions: [], authorized: true, capabilities: ['editTask'], dependencyIds: [], rowVersion: '1' };
    component.capabilities = ['editTask'];
  });

  it('emits reloadRequested, not cancel, from the 409 reload button', () => {
    const cancel = vi.fn();
    const reload = vi.fn();
    component.cancel.subscribe(cancel);
    component.reloadRequested.subscribe(reload);
    component.mutationState = { status: 'conflict', message: 'Task changed.' };
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('[data-testid="task-conflict-reload-button"]') as HTMLButtonElement).click();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('emits cancel, not reloadRequested, from the ordinary cancel button', () => {
    const cancel = vi.fn();
    const reload = vi.fn();
    component.cancel.subscribe(cancel);
    component.reloadRequested.subscribe(reload);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('[data-testid="task-cancel-button"]') as HTMLButtonElement).click();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });
});
