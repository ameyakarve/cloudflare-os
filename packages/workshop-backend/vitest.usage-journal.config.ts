import {defineConfig} from 'vitest/config';
import {cloudflareTest} from '@cloudflare/vitest-pool-workers';

export default defineConfig({
  plugins: [cloudflareTest({
    main: './__tests__/usage-journal-worker.ts',
    miniflare: {
      compatibilityDate: '2026-09-04',
      compatibilityFlags: ['nodejs_compat'],
      durableObjects: {TEST_USAGE_JOURNAL: {className: 'UsageJournalTestObject', useSQLite: true}},
    },
  })],
  test: {
    include: ['__tests__/usage-journal/*.test.ts'],
    setupFiles: ['@gadgets/scripts/assert-workerd'],
  },
});
