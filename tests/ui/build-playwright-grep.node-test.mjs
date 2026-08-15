import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildPlaywrightGrep } from '../../scripts/ci/build-playwright-grep.mjs';

test('builds an anchored escaped grep from active manifest titles', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aip-playwright-grep-'));
  try {
    const manifestPath = join(directory, 'required.txt');
    const specPath = join(directory, 'spec.ts');
    await writeFile(manifestPath, '# comment\nfirst test (P0)\nsecond.test\n', 'utf8');
    await writeFile(specPath, "test('first test (P0)', async () => {});\ntest('second.test', async () => {});\n", 'utf8');

    const grep = await buildPlaywrightGrep(manifestPath, { verifyPath: specPath });
    assert.equal(grep, '^(first test \\(P0\\)|second\\.test)$');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects duplicate active manifest titles', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aip-playwright-grep-'));
  try {
    const manifestPath = join(directory, 'required.txt');
    await writeFile(manifestPath, 'same test\nsame test\n', 'utf8');

    await assert.rejects(() => buildPlaywrightGrep(manifestPath), /duplicate titles/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects required titles that are missing or renamed in the real-backend spec', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aip-playwright-grep-'));
  try {
    const manifestPath = join(directory, 'required.txt');
    const specPath = join(directory, 'spec.ts');
    await writeFile(manifestPath, 'required test\n', 'utf8');
    await writeFile(specPath, "test('different test', async () => {});\n", 'utf8');

    await assert.rejects(
      () => buildPlaywrightGrep(manifestPath, { verifyPath: specPath }),
      /missing or renamed/u
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
