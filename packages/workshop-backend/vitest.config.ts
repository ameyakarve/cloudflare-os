import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import capnwebValidate from 'capnweb-validate/vite'

// Wrangler ships `*.txt` imports as Text modules (its default module rules; see
// src/text-modules.d.ts), but this config drives the pool from inline miniflare settings, and
// vite's own fallback would resolve them as asset URLs. Mirror the Text-module behavior so code
// under test (e.g. describeBinding's worktree-binding.txt) sees the real content. Like wrangler,
// match on the *import path*: resolving here keeps vite from realpathing the id, which for a
// symlinked .txt (the binding .txts are symlinks to their .d.ts) would dodge the load hook
// below and fall through to the TypeScript pipeline.
const textModules: Plugin = {
  name: 'text-modules',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source.endsWith('.txt') && importer !== undefined) {
      return path.resolve(path.dirname(importer), source)
    }
  },
  load(id) {
    if (id.endsWith('.txt')) {
      return `export default ${JSON.stringify(readFileSync(id, 'utf-8'))};`
    }
  },
}

/**
 * Tests run inside workerd (via vitest-pool-workers) so they exercise the same runtime APIs as
 * production -- e.g. Uint8Array.toHex/fromHex and crypto.subtle used by the sharing module. Most
 * tests import modules directly; the main Worker and a test-only SQLite DO binding support the
 * Overseer cost-persistence integration test without loading the full deployment configuration.
 */
export default defineConfig({
  resolve: { dedupe: ['@codemirror/state', '@codemirror/view', '@codemirror/language', '@lezer/common', '@lezer/highlight', '@lezer/lr'] },
  plugins: [
    textModules,
    capnwebValidate(),
    cloudflareTest({
      main: './__tests__/deployment-identity-worker.ts',
      miniflare: {
        serviceBindings: {MILESVAULT_LEDGER_APP: {name: "ledger-app-fixture", entrypoint: "LedgerApplication"}},
        workers: [{name: "ledger-app-fixture", modules: true, compatibilityDate: "2026-09-04",
          script: `
            import {WorkerEntrypoint, RpcTarget} from "cloudflare:workers";
            class Editor extends RpcTarget {
              #key; #save; #queue;
              constructor(key, save, queue) { super(); this.#key = key; this.#save = save; this.#queue = queue.dup(); }
              async listEntries() {
                await this.#queue.authorizeObservation({title: "Fixture read", description: "No canonical data"});
                return {rows: [{kind: "note", id: 1, raw_text: this.#key, updated_at: 1}]};
              }
              async completionData() { return {ledgerAccounts: [], catalogueAccounts: []}; }
              async replaceBuffer() { if (!this.#save) throw new Error("Browser Save only"); return {savedBy: this.#key}; }
              [Symbol.dispose]() { this.#queue[Symbol.dispose](); }
            }
            class Holdings extends RpcTarget {
              async currentHoldings() { return {asOf: 20260906, accounts: [], balances: []}; }
            }
            export class LedgerApplication extends WorkerEntrypoint {
              async openBrowserEditor(key, queue) { return new Editor(key, true, queue); }
              async openEditorResource(key, queue) { return new Editor(key, false, queue); }
              async openHoldings() { return new Holdings(); }
              async getEditorTypes() { return "interface LedgerEditorSession {}"; }
              async getHoldingsTypes() { return "interface LedgerHoldingsSession {}"; }
            }
          `}],
        compatibilityDate: '2026-09-04',
        compatibilityFlags: ['experimental', 'nodejs_compat', 'allow_irrevocable_stub_storage'],
        durableObjects: {
          TEST_LEDGER_EDITOR: {className: "LedgerEditorGatekeeper", useSQLite: true},
          TEST_OVERSEER: { className: 'OverseerDurableObject', useSQLite: true },
          TEST_USER: { className: 'UserDurableObject', useSQLite: true },
          TEST_LANGUAGE_MODEL: { className: 'LanguageModelGatekeeper', useSQLite: true },
          TEST_LEDGER_HOLDINGS: { className: 'LedgerHoldingsGatekeeper', useSQLite: true },
          TEST_IDENTITY_GATEKEEPER: { className: 'IdentityTestGatekeeper', useSQLite: true },
        },
      },
    }),
  ],
  test: {
    include: ['__tests__/*.test.ts'],
    // Asserts the pool actually started, rather than trusting a green run to mean workerd.
    setupFiles: ['@gadgets/scripts/assert-workerd'],
  },
})
