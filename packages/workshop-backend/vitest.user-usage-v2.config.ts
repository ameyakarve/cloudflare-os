import {defineConfig} from 'vitest/config';
import {cloudflareTest} from '@cloudflare/vitest-pool-workers';
import {buildSync} from 'esbuild';
import capnwebValidate from 'capnweb-validate/vite';
import {resolve} from 'node:path';

// Explicit checked M worktree; bundle actual policy + UsageDO, never a copied accounting implementation.
const canonical = process.env.MILESVAULT_CANONICAL_ROOT;
if (!canonical) throw new Error('MILESVAULT_CANONICAL_ROOT must name the reviewed M checkout');
const scriptPath = resolve('.wrangler/user-usage-v2/canonical.mjs');
buildSync({entryPoints: [resolve(canonical, 'src/durable/__tests__/os-usage/user-boundary-worker.ts')],
  outfile: scriptPath, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'],
  tsconfig: resolve(canonical, 'tsconfig.json')});
export default defineConfig({
  plugins: [capnwebValidate(), cloudflareTest({
    main: './__tests__/user-usage-v2/worker.ts',
    miniflare: {
      compatibilityDate: '2026-09-04',
      compatibilityFlags: ['nodejs_compat', 'experimental', 'allow_irrevocable_stub_storage'],
      bindings: {DEPLOYMENT_USAGE_V2_ROUTE: 'DEPLOYMENT_USAGE_V2_ROUTE_fixture'},
      serviceBindings: {
        DEPLOYMENT_USAGE_V2_ROUTE_fixture: {name: 'canonical-usage', entrypoint: 'OsUsagePolicy'},
        DEPLOYMENT_USAGE_POLICY: {name: 'canonical-usage', entrypoint: 'OsUsagePolicy'},
        CANONICAL_INSPECT: 'canonical-usage',
        DEPLOYMENT_ACCESS_POLICY: {name: 'vitest-pool-workers-runner-', entrypoint: 'BoundaryAccess'},
      },
      durableObjects: {TEST_USER_V2: {className: 'UserDurableObject', useSQLite: true}, ACCESS_STATE: {className: 'AccessState', useSQLite: true}},
      workers: [{name: 'canonical-usage', modules: true, scriptPath, compatibilityDate: '2026-09-04',
        compatibilityFlags: ['nodejs_compat'], bindings: {OS_BUDGET_CONFIG: JSON.stringify({concurrentRuns: 20})},
        durableObjects: {USAGE_DO: {className: 'BoundaryUsageDO', useSQLite: true}}}],
    },
  })],
  test: {include: ['__tests__/user-usage-v2/*.test.ts'], setupFiles: ['@gadgets/scripts/assert-workerd'],
    fileParallelism: false, testTimeout: 20000},
});
