import { routes } from './app.routes';

describe('application Project Task routes', () => {
  it('places the New Task route before generic Task detail so "new" is never treated as an ID', () => {
    const shell = routes.find((route) => route.path === '');
    const children = shell?.children ?? [];
    const createIndex = children.findIndex((route) => route.path === 'projects/:projectId/tasks/new');
    const detailIndex = children.findIndex((route) => route.path === 'projects/:projectId/tasks/:taskId');

    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(detailIndex).toBeGreaterThan(createIndex);
    expect(children[createIndex]?.loadComponent).toBeDefined();
  });
});
