import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildCompatCriticalGrep,
  loadCompatCriticalContract,
  selectCompatCriticalTests,
  validateCompatCriticalContract,
  verifyCompatCriticalDiscovery,
  verifyCompatCriticalSources
} from '../../scripts/ci/compat-critical-contract.mjs';

const repositoryContractPath = 'scripts/ci/compat-critical.contract.json';

test('repository compat-critical contract is fail-closed and source-resolvable', async () => {
  const contract = await loadCompatCriticalContract(repositoryContractPath, { now: new Date('2026-09-04T00:00:00Z') });
  await verifyCompatCriticalSources(contract);

  assert.equal(contract.name, 'compat-critical');
  assert.equal(selectCompatCriticalTests(contract, 'browser-engine').length, 4);
  assert.equal(selectCompatCriticalTests(contract, 'mobile').length, 4);
  assert.equal(selectCompatCriticalTests(contract, 'os-portability').length, 2);
  assert.equal(selectCompatCriticalTests(contract, 'real-backend').length, 1);
});

test('grep selection anchors exact test titles instead of file names', () => {
  const contract = validateCompatCriticalContract(baseContract());
  const grep = new RegExp(buildCompatCriticalGrep(contract, 'browser-engine'), 'u');
  assert.equal(grep.test('chromium-desktop › smoke.spec.ts › suite › Shell boot'), true);
  assert.equal(grep.test('chromium-desktop › smoke.spec.ts › suite › Shell boot renamed'), false);
  assert.equal(grep.test('chromium-desktop › smoke.spec.ts › suite › Navigation'), true);
});

test('profile with zero active non-quarantined tests fails closed', () => {
  const contract = baseContract();
  contract.profiles.empty = { description: 'Empty profile', requiredCategories: ['boot'] };
  assert.throws(() => validateCompatCriticalContract(contract), /Profile empty selects zero non-quarantined/u);
});

test('missing required category fails closed', () => {
  const contract = baseContract();
  contract.tests = contract.tests.filter((entry) => !entry.categories.includes('navigation'));
  assert.throws(() => validateCompatCriticalContract(contract), /missing required coverage categories: navigation/u);
});

test('obsolete or superseded tests cannot stay selected', () => {
  const contract = baseContract();
  contract.tests[0] = { ...contract.tests[0], status: 'superseded' };
  assert.throws(() => validateCompatCriticalContract(contract), /must not remain attached to a selection profile/u);
});

test('quarantine requires reason owner issue and expiry and cannot erase required coverage', () => {
  const contract = baseContract();
  contract.quarantines = [{ testId: 'COMPAT-BOOT-001', reason: '', owner: '@ci-owner', issue: '#584', expiresOn: '2026-09-30' }];
  assert.throws(() => validateCompatCriticalContract(contract, { now: new Date('2026-09-04T00:00:00Z') }), /reason.*non-empty/u);

  contract.quarantines[0].reason = 'Firefox focus regression under investigation';
  assert.throws(
    () => validateCompatCriticalContract(contract, { now: new Date('2026-10-01T00:00:00Z') }),
    /expired on 2026-09-30/u
  );

  assert.throws(
    () => validateCompatCriticalContract(contract, { now: new Date('2026-09-04T00:00:00Z') }),
    /missing required coverage categories: boot/u
  );
});

test('source verifier rejects arbitrary sleep, unseeded randomness, and pixel-only assertions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'compat-critical-'));
  try {
    await mkdir(path.join(root, 'tests/ui'), { recursive: true });
    const cases = [
      ['waitForTimeout', "await page.waitForTimeout(100);"],
      ['Math.random', 'Math.random();'],
      ['pixel screenshot', 'await expect(page).toHaveScreenshot();']
    ];

    for (const [label, statement] of cases) {
      await writeFile(
        path.join(root, 'tests/ui/smoke.spec.ts'),
        `import { test } from '@playwright/test';\ntest.describe('suite', () => {\n  test('Shell boot', async ({ page }) => { ${statement} });\n  test('Navigation', async () => {});\n});\n`
      );
      const contract = validateCompatCriticalContract(baseContract({ singleFile: true }));
      await assert.rejects(() => verifyCompatCriticalSources(contract, root), new RegExp(label, 'u'));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('discovery verifier rejects empty or partial Playwright selection', () => {
  const contract = validateCompatCriticalContract(baseContract());
  assert.throws(() => verifyCompatCriticalDiscovery(contract, 'browser-engine', 'Listing tests:\nTotal: 0 tests'), /zero/u);

  const partial = 'Listing tests:\n  [chromium-desktop] › smoke.spec.ts:1:1 › suite › Shell boot\nTotal: 1 test';
  assert.throws(() => verifyCompatCriticalDiscovery(contract, 'browser-engine', partial), /Navigation.*found 0/u);

  const complete = [
    'Listing tests:',
    '  [chromium-desktop] › smoke.spec.ts:1:1 › suite › Shell boot',
    '  [chromium-desktop] › navigation.spec.ts:1:1 › suite › Navigation',
    'Total: 2 tests in 2 files'
  ].join('\n');
  assert.deepEqual(verifyCompatCriticalDiscovery(contract, 'browser-engine', complete), {
    selectedCount: 2,
    discoveredCount: 2
  });
});

function baseContract(options = {}) {
  return {
    schemaVersion: 1,
    name: 'compat-critical',
    defaultProfile: 'browser-engine',
    requiredCategories: ['boot', 'navigation'],
    profiles: {
      'browser-engine': {
        description: 'Browser compatibility',
        requiredCategories: ['boot', 'navigation']
      }
    },
    quarantines: [],
    tests: [
      {
        id: 'COMPAT-BOOT-001',
        file: 'tests/ui/smoke.spec.ts',
        title: 'Shell boot',
        categories: ['boot'],
        profiles: ['browser-engine'],
        status: 'active'
      },
      {
        id: 'COMPAT-NAV-001',
        file: options.singleFile ? 'tests/ui/smoke.spec.ts' : 'tests/ui/navigation.spec.ts',
        title: 'Navigation',
        categories: ['navigation'],
        profiles: ['browser-engine'],
        status: 'active'
      }
    ]
  };
}
