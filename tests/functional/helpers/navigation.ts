import { expect, type Page } from '@playwright/test';

export async function openWorkspaceProjects(page: Page, workspaceId: string): Promise<void> {
  const path = `/workspaces/${encodeURIComponent(workspaceId)}/projects`;
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(`${escapeRegex(path)}(?:[/?#]|$)`, 'u'));
}

export async function openProject(page: Page, projectId: string): Promise<void> {
  const path = `/projects/${encodeURIComponent(projectId)}`;
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(`${escapeRegex(path)}(?:[/?#]|$)`, 'u'));
}

export async function openTask(page: Page, projectId: string, taskId: string): Promise<void> {
  const path = `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`;
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(`${escapeRegex(path)}(?:[/?#]|$)`, 'u'));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
