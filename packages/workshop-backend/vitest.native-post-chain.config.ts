import {defineConfig} from 'vitest/config';
import {cloudflareTest} from '@cloudflare/vitest-pool-workers';
import {buildSync} from 'esbuild';
import capnwebValidate from 'capnweb-validate/vite';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {NATIVE_POST_CONTRACT_DIGEST} from '../workshop-shared/src/os-native-post-schema.generated';
const canonical = process.env.MILESVAULT_CANONICAL_ROOT;
if (!canonical) throw new Error('Explicit MILESVAULT_CANONICAL_ROOT required');
const wrapper = resolve('../../../packages/custom-gatekeeper');
const scriptPath = resolve('.wrangler/native-post-chain/canonical.mjs');
buildSync({entryPoints: [resolve(wrapper, 'native-post-chain/canonical.ts')], outfile: scriptPath,
  bundle: true, format: 'esm', platform: 'node', mainFields: ['module', 'main'], conditions: ['workerd', 'worker', 'browser'], external: ['cloudflare:*', 'node:*'],
  alias: {'canonical-native': resolve(canonical, 'src'), '@': resolve(canonical, 'src')},
  tsconfig: resolve(canonical, 'tsconfig.json')});
const pins = {NATIVE_POST_HUMAN_V2: 'true', NATIVE_POST_CONTRACT_DIGEST, NATIVE_POST_RENDERER_ARTIFACT_DIGEST: 'b'.repeat(64)};
export default defineConfig({
  resolve: {alias: {'wrapper-native': resolve(wrapper, 'src')}},
  plugins: [{name: 'native-text-modules', enforce: 'pre',
    resolveId(source, importer) { if (source.endsWith('.txt') && importer) return resolve(dirname(importer), source); },
    load(id) { if (id.endsWith('.txt')) return `export default ${JSON.stringify(readFileSync(id, 'utf8'))};`; },
  }, capnwebValidate({tsconfig: './tsconfig.native-post-chain.json'}), cloudflareTest({main: './__tests__/native-post-chain/worker.ts', miniflare: {
    outboundService: () => { throw new Error('Native chain fixture forbids external network'); },
    compatibilityDate: '2026-09-04', compatibilityFlags: ['nodejs_compat', 'experimental', 'allow_irrevocable_stub_storage'],
    workerLoaders: {LOADER: {}},
    bindings: {...pins, DEPLOYMENT_USAGE_REQUIRED: 'true', DEPLOYMENT_USAGE_V2_ROUTE: 'DEPLOYMENT_USAGE_V2_ROUTE_fixture'},
    serviceBindings: {
      DEPLOYMENT_USAGE_V2_ROUTE_fixture: {name: 'canonical-native-chain', entrypoint: 'OsUsagePolicy'},
      DEPLOYMENT_USAGE_POLICY: {name: 'canonical-native-chain', entrypoint: 'OsUsagePolicy'},
      CANONICAL_INSPECT: 'canonical-native-chain',
      DEPLOYMENT_ACCESS_POLICY: {name: 'vitest-pool-workers-runner-', entrypoint: 'BoundaryAccess'},
      NATIVE_POST_APPLICATION: {name: 'vitest-pool-workers-runner-', entrypoint: 'NativePostFactory'},
      NATIVE_POST_CANONICAL: {name: 'canonical-native-chain', entrypoint: 'OsNativePost'},
    },
    durableObjects: {
      TEST_NATIVE_BARRIER: {className: 'NativeChainBarrier', useSQLite: true},
      TEST_PAIRED_PROBE: {className: 'PairedOverseerProbe', useSQLite: true},
      TEST_OVERSEER: {className: 'OverseerDurableObject', useSQLite: true},
      TEST_USER_V2: {className: 'UserDurableObject', useSQLite: true},
      ACCESS_STATE: {className: 'AccessState', useSQLite: true},
      NATIVE_POST_CONTEXTS: {className: 'NativePostContext', useSQLite: true},
    },
    workers: [{name: 'canonical-native-chain', modules: true, scriptPath, compatibilityDate: '2026-09-04',
      outboundService: () => { throw new Error('Native chain fixture forbids canonical external network'); },
      compatibilityFlags: ['nodejs_compat'], bindings: {...pins, OS_BUDGET_CONFIG: JSON.stringify({concurrentRuns: 20})},
      serviceBindings: {NATIVE_POST_ISSUER: {name: 'vitest-pool-workers-runner-', entrypoint: 'NativePostIssuer'}},
      durableObjects: {USAGE_DO: {className: 'BoundaryUsageDO', useSQLite: true}, LEDGER_DO: {className: 'ChainLedgerDO', useSQLite: true}},
    }],
  }})],
  test: {include: ['__tests__/native-post-chain/*.test.ts'], setupFiles: ['@gadgets/scripts/assert-workerd'], fileParallelism: false, testTimeout: 20000},
});
