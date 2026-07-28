import { ProjectMockRecord, ProjectsScenario, TaskMockRecord } from './projects.types';

export const PROJECTS_PRIMARY_PROJECT_ID = 'project-sample-alpha';
export const PROJECTS_PRIMARY_TASK_ID = 'task-sample-001';
export const PROJECTS_UNAUTHORIZED_PROJECT_NAME = 'Unauthorized Project Name Should Not Render';
export const PROJECTS_UNAUTHORIZED_TASK_TITLE = 'Unauthorized Task Title Should Not Render';

const managerCapabilities = ['editTask', 'assignTask', 'changeTaskStatus', 'editMilestone'] as const;
const contributorCapabilities = ['editTask', 'assignTask', 'changeTaskStatus'] as const;

export const DEFAULT_PROJECTS: readonly ProjectMockRecord[] = [
  {
    id: PROJECTS_PRIMARY_PROJECT_ID,
    name: 'Sample Project Alpha',
    status: 'active',
    statusLabel: 'Active',
    startDate: '2026-04-01',
    dueDate: '2026-08-30',
    group: 'Sample Group A',
    authorized: true,
    canCreateTask: true
  },
  {
    id: 'project-sample-beta',
    name: 'Sample Project Beta',
    status: 'atRisk',
    statusLabel: 'At risk',
    startDate: '2026-05-10',
    dueDate: '2026-09-15',
    group: 'Sample Group B',
    authorized: true,
    canCreateTask: true
  },
  {
    id: 'project-hidden-denied',
    name: PROJECTS_UNAUTHORIZED_PROJECT_NAME,
    status: 'active',
    statusLabel: 'Active',
    startDate: '2026-03-01',
    dueDate: '2026-07-31',
    group: 'Hidden Group',
    authorized: false,
    canCreateTask: false
  }
];

export const DEFAULT_TASKS: readonly TaskMockRecord[] = [
  {
    id: PROJECTS_PRIMARY_TASK_ID,
    projectId: PROJECTS_PRIMARY_PROJECT_ID,
    title: 'Prepare sample kickoff checklist',
    description: 'Draft a fictional checklist for the sample project kickoff.',
    status: 'inProgress',
    statusLabel: 'In progress',
    priority: 'high',
    priorityLabel: 'High',
    assignee: 'Sample Member 01',
    startDate: '2026-04-02',
    dueDate: '2026-07-12',
    progressPercent: 45,
    milestone: 'Kickoff',
    dependencyIds: ['task-sample-002'],
    allowedTransitions: ['blocked', 'review', 'done'],
    capabilities: managerCapabilities,
    authorized: true,
    rowVersion: 'row-version-001'
  },
  {
    id: 'task-sample-002',
    projectId: PROJECTS_PRIMARY_PROJECT_ID,
    title: 'Collect sample project notes',
    description: 'Collect mock notes from the fictional working group.',
    status: 'done',
    statusLabel: 'Done',
    priority: 'medium',
    priorityLabel: 'Medium',
    assignee: 'Sample Member 02',
    startDate: '2026-04-03',
    dueDate: '2026-06-28',
    progressPercent: 100,
    milestone: 'Kickoff',
    dependencyIds: [],
    allowedTransitions: ['review'],
    capabilities: contributorCapabilities,
    authorized: true,
    rowVersion: 'row-version-002'
  },
  {
    id: 'task-sample-003',
    projectId: 'project-sample-beta',
    title: 'Review sample milestone risk',
    description: 'Summarize mock schedule risk for review.',
    status: 'blocked',
    statusLabel: 'Blocked',
    priority: 'urgent',
    priorityLabel: 'Urgent',
    assignee: 'Sample Member 03',
    startDate: '2026-05-15',
    dueDate: '2026-07-20',
    progressPercent: 20,
    milestone: 'Risk review',
    dependencyIds: ['task-sample-004'],
    allowedTransitions: ['inProgress'],
    capabilities: contributorCapabilities,
    authorized: true,
    rowVersion: 'row-version-003'
  },
  {
    id: 'task-sample-004',
    projectId: 'project-sample-beta',
    title: 'Publish sample review pack',
    description: 'Prepare fictional review material for the sample project.',
    status: 'notStarted',
    statusLabel: 'Not started',
    priority: 'low',
    priorityLabel: 'Low',
    assignee: 'Sample Member 01',
    startDate: '2026-07-21',
    dueDate: '2026-08-05',
    progressPercent: 0,
    milestone: 'Risk review',
    dependencyIds: [],
    allowedTransitions: ['inProgress'],
    capabilities: contributorCapabilities,
    authorized: true,
    rowVersion: 'row-version-004'
  },
  {
    id: 'task-hidden-denied',
    projectId: 'project-hidden-denied',
    title: PROJECTS_UNAUTHORIZED_TASK_TITLE,
    description: 'Hidden unauthorized mock task.',
    status: 'inProgress',
    statusLabel: 'In progress',
    priority: 'high',
    priorityLabel: 'High',
    assignee: 'Hidden Assignee',
    startDate: '2026-01-01',
    dueDate: '2026-12-31',
    progressPercent: 55,
    milestone: 'Hidden',
    dependencyIds: [],
    allowedTransitions: ['done'],
    capabilities: managerCapabilities,
    authorized: false,
    rowVersion: 'row-version-hidden'
  }
];

const MANY_TASKS: readonly TaskMockRecord[] = Array.from({ length: 128 }, (_, index) => {
  const number = String(index + 1).padStart(3, '0');
  const base = DEFAULT_TASKS[index % 4];
  return {
    ...base,
    id: `task-many-${number}`,
    title: `Sample bounded task ${number}`,
    assignee: index % 2 === 0 ? 'Sample Member 01' : 'Sample Member 02',
    progressPercent: index % 101,
    rowVersion: `row-version-many-${number}`
  };
});

export const LONG_TITLE_TASK: TaskMockRecord = {
  ...DEFAULT_TASKS[0],
  id: 'task-long-title',
  title:
    'Very long sample task title for verifying wrapping in constrained project task grid and detail layouts without revealing real work names',
  rowVersion: 'row-version-long-title'
};

export const PROJECTS_SCENARIOS = {
  default: {
    status: 'ready',
    title: 'Projects',
    subtitle: 'Mock project and task planning',
    projects: DEFAULT_PROJECTS,
    tasks: DEFAULT_TASKS,
    currentUserAssignee: 'Sample Member 01'
  },
  loading: {
    status: 'loading',
    title: 'Projects',
    subtitle: 'Mock project and task planning',
    projects: [],
    tasks: [],
    currentUserAssignee: 'Sample Member 01'
  },
  empty: {
    status: 'empty',
    title: 'Projects',
    subtitle: 'Mock project and task planning',
    projects: [],
    tasks: [],
    currentUserAssignee: 'Sample Member 01'
  },
  permissionDenied: {
    status: 'permissionDenied',
    title: 'Projects',
    subtitle: 'Mock project and task planning',
    projects: DEFAULT_PROJECTS,
    tasks: DEFAULT_TASKS,
    currentUserAssignee: 'Sample Member 01',
    message: 'You do not have permission to view projects in this workspace.'
  },
  manyRowsBoundedPage: {
    status: 'ready',
    title: 'Tasks',
    subtitle: 'Many mock rows',
    projects: DEFAULT_PROJECTS,
    tasks: MANY_TASKS,
    currentUserAssignee: 'Sample Member 01'
  },
  rowVersionConflict: {
    status: 'ready',
    detailState: 'rowVersionConflict',
    title: 'Task detail',
    subtitle: 'Recoverable conflict',
    projects: DEFAULT_PROJECTS,
    tasks: DEFAULT_TASKS,
    currentUserAssignee: 'Sample Member 01'
  },
  taskSaveConflict: {
    status: 'ready',
    title: 'Task detail',
    subtitle: 'Task save conflict',
    projects: DEFAULT_PROJECTS,
    tasks: DEFAULT_TASKS,
    currentUserAssignee: 'Sample Member 01',
    taskMutationState: { status: 'conflict', message: 'The task changed on the server. Reload before saving.', requestId: 'story-task-conflict' }
  },
  taskConflictReloadLoading: {
    status: 'ready', title: 'Task detail', subtitle: 'Task conflict reload in progress', projects: DEFAULT_PROJECTS, tasks: DEFAULT_TASKS, currentUserAssignee: 'Sample Member 01',
    taskMutationState: { status: 'conflict', message: 'The task changed on the server. Reload before saving.', requestId: 'story-task-conflict' }, taskConflictReloadState: 'loading'
  },
  taskConflictReloadError: {
    status: 'ready', title: 'Task detail', subtitle: 'Task conflict reload failed', projects: DEFAULT_PROJECTS, tasks: DEFAULT_TASKS, currentUserAssignee: 'Sample Member 01',
    taskMutationState: { status: 'conflict', message: 'The task changed on the server. Reload before saving.', requestId: 'story-task-conflict' }, taskConflictReloadState: 'error'
  },
  taskSavedButRefreshFailed: {
    status: 'ready', title: 'Task detail', subtitle: 'Task saved but latest data unavailable', projects: DEFAULT_PROJECTS, tasks: DEFAULT_TASKS, currentUserAssignee: 'Sample Member 01',
    taskMutationState: { status: 'savedButRefreshFailed', message: 'The latest task detail request failed.', requestId: 'story-after-save-refresh' }
  },
  invalidStateTransition: {
    status: 'ready',
    detailState: 'invalidStateTransition',
    title: 'Task detail',
    subtitle: 'Recoverable transition error',
    projects: DEFAULT_PROJECTS,
    tasks: DEFAULT_TASKS,
    currentUserAssignee: 'Sample Member 01'
  },
  longTaskTitles: {
    status: 'ready',
    title: 'Tasks',
    subtitle: 'Long title coverage',
    projects: DEFAULT_PROJECTS,
    tasks: [LONG_TITLE_TASK, ...DEFAULT_TASKS],
    currentUserAssignee: 'Sample Member 01'
  },
  milestoneReadOnly: {
    status: 'ready',
    title: 'Task detail',
    subtitle: 'Milestone read only',
    projects: DEFAULT_PROJECTS,
    tasks: DEFAULT_TASKS.map((task) => ({
      ...task,
      capabilities: task.capabilities.filter((capability) => capability !== 'editMilestone')
    })),
    currentUserAssignee: 'Sample Member 01'
  },
  dependenciesDisplayOnly: {
    status: 'ready',
    title: 'Task detail',
    subtitle: 'Dependencies display only',
    projects: DEFAULT_PROJECTS,
    tasks: DEFAULT_TASKS,
    currentUserAssignee: 'Sample Member 01'
  },
  mobile: {
    status: 'ready',
    title: 'Tasks',
    subtitle: 'Mobile task list',
    projects: DEFAULT_PROJECTS,
    tasks: DEFAULT_TASKS,
    currentUserAssignee: 'Sample Member 01',
    mobile: true
  }
} satisfies Record<string, ProjectsScenario>;
