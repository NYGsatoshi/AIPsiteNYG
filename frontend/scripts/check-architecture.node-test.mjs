import assert from 'node:assert/strict';
import test from 'node:test';

import { findDisallowedSyncfusionImports } from './check-architecture.mjs';

test('rejects direct Syncfusion imports from a feature path', () => {
  const offenders = findDisallowedSyncfusionImports([
    {
      path: '/repo/frontend/src/app/features/files/files-page.component.ts',
      source: "import { UploaderComponent } from '@syncfusion/ej2-angular-inputs';"
    }
  ]);

  assert.deepEqual(offenders, ['/repo/frontend/src/app/features/files/files-page.component.ts']);
});

test('allows Syncfusion imports only in approved adapter locations', () => {
  const offenders = findDisallowedSyncfusionImports([
    {
      path: '/repo/frontend/src/app/shared/ui/adapters/syncfusion/syncfusion-uploader.adapter.ts',
      source: "import { UploaderComponent } from '@syncfusion/ej2-angular-inputs';"
    },
    {
      path: '/repo/frontend/src/app/shared/vendor/syncfusion/license.ts',
      source: "import { registerLicense } from '@syncfusion/ej2-base';"
    }
  ]);

  assert.deepEqual(offenders, []);
});
