export const WORK_STATUS_VALUES = [
  'draft',
  'running',
  'ready',
  'needsReview',
  'needsAttention',
  'completed',
  'paused',
  'archived'
] as const;

export type WorkStatus = (typeof WORK_STATUS_VALUES)[number];

const WORK_STATUS_LABELS: Readonly<Record<WorkStatus, string>> = {
  draft: 'Draft',
  running: 'Running',
  ready: 'Ready',
  needsReview: 'Needs review',
  needsAttention: 'Needs attention',
  completed: 'Completed',
  paused: 'Paused',
  archived: 'Archived'
};

export function workStatusLabel(status: WorkStatus): string {
  return WORK_STATUS_LABELS[status];
}
