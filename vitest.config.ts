import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'apps/api/test/**/*.spec.ts',
      'packages/harness/test/**/*.spec.ts',
      'scripts/test/**/*.spec.ts',
    ],
    testTimeout: 15_000,
  },
});
