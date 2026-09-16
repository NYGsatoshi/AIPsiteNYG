import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(repoRoot, relativePath), 'utf8'));
}

const inventoryPath = 'docs/migration/avalonia/angular-frontend-inventory.json';
const freezePath = 'docs/migration/avalonia/angular-feature-freeze-matrix.json';

const novemberCoreRoutes = new Set([
  '/login',
  '/session-expired',
  '/permission-denied',
  '/',
  '/workspaces/:workspaceId/projects',
  '/workspaces',
  '/projects/:projectId/tasks/new',
  '/projects/:projectId/tasks/:taskId',
  '/projects/:projectId',
  '/projects',
]);

const postNovemberRoutes = new Set([
  '/messages',
  '/conversations/:conversationId',
  '/workspaces/:workspaceId/channels/:conversationId',
  '/dm/:conversationId',
  '/admin/audit/findings',
  '/admin/audit/claims-evidence',
  '/admin/audit/package-export',
  '/admin/audit',
  '/admin/invites',
  '/admin/export-diagnostics',
]);

test('AV-MIG inventory and freeze matrix cover the same production routes', async () => {
  const [inventory, freeze] = await Promise.all([readJson(inventoryPath), readJson(freezePath)]);
  assert.equal(inventory.routes.length, 38, 'inventory route count must remain the pinned 38-route snapshot');
  assert.equal(freeze.routes.length, 38, 'freeze matrix must classify every pinned production route');

  const inventoryPaths = inventory.routes.map((route) => route.path).sort();
  const freezePaths = freeze.routes.map((route) => route.path).sort();
  assert.deepEqual(freezePaths, inventoryPaths, 'inventory and freeze matrix route sets must match exactly');
});

test('every routed screen has an explicit state owner', async () => {
  const [inventory, freeze] = await Promise.all([readJson(inventoryPath), readJson(freezePath)]);
  const freezeByPath = new Map(freeze.routes.map((route) => [route.path, route]));

  for (const route of inventory.routes) {
    if (route.kind !== 'screen') {
      continue;
    }
    assert.ok(
      Array.isArray(route.stateOwners) && route.stateOwners.length > 0,
      `${route.path} must declare at least one inventory state owner`,
    );
    const matrixRoute = freezeByPath.get(route.path);
    assert.ok(matrixRoute, `${route.path} must exist in the freeze matrix`);
    assert.ok(
      typeof matrixRoute.stateOwner === 'string' && matrixRoute.stateOwner.trim() !== '' && matrixRoute.stateOwner !== 'none',
      `${route.path} must declare a concrete freeze-matrix state owner`,
    );
  }

  const diagnostics = inventory.routes.find((route) => route.path === '/admin/export-diagnostics');
  assert.ok(diagnostics?.stateOwners.includes('AdminFacade'), '/admin/export-diagnostics must be owned by AdminFacade');
  assert.equal(
    freezeByPath.get('/admin/export-diagnostics')?.stateOwner,
    'AdminFacade',
    '/admin/export-diagnostics freeze ownership must match its implementation',
  );
});

test('November scope stays aligned with the #798 core roadmap', async () => {
  const [inventory, freeze] = await Promise.all([readJson(inventoryPath), readJson(freezePath)]);
  const freezeByPath = new Map(freeze.routes.map((route) => [route.path, route]));

  for (const path of novemberCoreRoutes) {
    const route = freezeByPath.get(path);
    assert.ok(route, `${path} must exist in the freeze matrix`);
    assert.equal(route.november, true, `${path} must remain November-required`);
    assert.equal(route.freeze, 'November Required', `${path} must use the November Required freeze class`);
  }

  for (const path of postNovemberRoutes) {
    const route = freezeByPath.get(path);
    assert.ok(route, `${path} must exist in the freeze matrix`);
    assert.equal(route.november, false, `${path} must remain outside the November core preview`);
  }

  for (const route of inventory.routes) {
    const matrixRoute = freezeByPath.get(route.path);
    if (route.demoScope === 'november-core') {
      assert.equal(matrixRoute?.november, true, `${route.path} demoScope conflicts with the freeze matrix`);
    }
    if (typeof route.demoScope === 'string' && route.demoScope.startsWith('post-november-')) {
      assert.equal(matrixRoute?.november, false, `${route.path} post-November scope conflicts with the freeze matrix`);
    }
  }

  const graph = freeze.nonRouteSurfaces.find((surface) => surface.surface.startsWith('Graph surface'));
  assert.ok(graph, 'graph non-route surface must remain inventoried');
  assert.equal(graph.november, false, 'graph is not November-required under the current #798 roadmap');
  assert.equal(graph.freeze, 'Avalonia First');
});
