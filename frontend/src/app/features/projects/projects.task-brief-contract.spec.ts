import { toCreateTaskRequestDto, toUpdateTaskRequestDto } from './projects.api';
import { mapTaskDtoToRecord } from './projects.mapper';

describe('Task Brief API contract', () => {
  it('maps canonical values only when the backend supplies truthful taskSpecific provenance', () => {
    const task = mapTaskDtoToRecord({
      id: 'task-1',
      projectId: 'project-1',
      title: 'Brief',
      brief: {
        goal: { value: 'Reach review', source: 'taskSpecific' },
        deliverable: { value: null, source: 'notSet' },
        constraints: { value: 'Do not expose secrets', source: 'unexpected' }
      }
    }, []);

    expect(task.brief).toEqual({
      goal: { value: 'Reach review', source: 'taskSpecific' },
      deliverable: { value: null, source: 'notSet' },
      constraints: { value: null, source: 'notSet' }
    });
  });

  it('keeps legacy create and update request shapes compatible when brief fields are omitted', () => {
    const create = toCreateTaskRequestDto({
      title: 'Legacy', description: 'Free-form', priority: 'medium', startDate: '', dueDate: ''
    });
    const update = toUpdateTaskRequestDto({
      title: 'Legacy', description: 'Free-form', priority: 'medium', startDate: '', dueDate: '',
      progressPercent: 0, expectedVersion: '1'
    });

    expect('goal' in create).toBe(false);
    expect('deliverable' in create).toBe(false);
    expect('constraints' in create).toBe(false);
    expect('goal' in update).toBe(false);
    expect('deliverable' in update).toBe(false);
    expect('constraints' in update).toBe(false);
    expect(create.description).toBe('Free-form');
    expect(update.description).toBe('Free-form');

    const legacyResponse = mapTaskDtoToRecord({
      id: 'legacy-task', projectId: 'project-1', title: 'Legacy', description: 'Free-form'
    }, []);
    expect(legacyResponse.brief).toBeUndefined();
  });

  it('trims supplied brief values and sends empty values as explicit null clears', () => {
    const create = toCreateTaskRequestDto({
      title: 'Brief', description: '', goal: ' Goal ', deliverable: '', constraints: ' Constraint ',
      priority: 'high', startDate: '', dueDate: ''
    });
    const update = toUpdateTaskRequestDto({
      title: 'Brief', description: '', goal: ' Goal ', deliverable: '', constraints: ' Constraint ',
      priority: 'high', startDate: '', dueDate: '', progressPercent: 10, expectedVersion: '2'
    });

    expect(create).toMatchObject({ goal: 'Goal', deliverable: null, constraints: 'Constraint' });
    expect(update).toMatchObject({ goal: 'Goal', deliverable: null, constraints: 'Constraint' });
  });
});
