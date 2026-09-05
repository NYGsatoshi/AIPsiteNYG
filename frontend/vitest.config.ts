import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    deps: {
      // Syncfusion's Angular wrappers publish CommonJS interop through
      // @syncfusion/ej2-angular-base. Keep the scope vendor-specific so Vitest
      // runs these packages through Vite instead of native Node ESM loading.
      inline: [/@syncfusion\/ej2-angular-/],
    },
  },
  test: {
    // Angular's test builder otherwise reuses a non-isolated fork across test
    // files. Each file owns TestBed and jsdom state, so isolate it to release
    // accumulated state before the next file is scheduled.
    isolate: true,
    setupFiles: ['./vitest.setup.ts'],
  },
});
