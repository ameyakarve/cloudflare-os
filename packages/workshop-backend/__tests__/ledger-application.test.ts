import {env, RpcStub, RpcTarget} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {expect, it} from 'vitest';
import type {ApprovalQueue, GitCache} from '@gadgets/workshop-shared/gatekeeper';
import type {LedgerEditorGatekeeper, LedgerHoldingsGatekeeper} from '../src/overseer';

class Queue extends RpcTarget implements ApprovalQueue {
  reads = 0;
  async authorizeObservation() { this.reads++; }
  async getUsageBudget() { return undefined; }
  async getGitCache(): Promise<GitCache> { throw new Error('Unexpected Git'); }
  async submitAction() { throw new Error('Unexpected write'); }
  async bindHook() { throw new Error('Unexpected hook'); }
}
it('delegates persisted Ledger facets across the private native service with the exact key', async () => {
  await runInDurableObject(env.TEST_USER.getByName(crypto.randomUUID()), async (instance, ctx) => {
    {
      const editor = ctx.facets.get<LedgerEditorGatekeeper>('ledger-app-editor', () => ({class:
        ctx.exports.LedgerEditorGatekeeper({props: {ledgerKey: 'Member@example.com'}})}));
      const holdings = ctx.facets.get<LedgerHoldingsGatekeeper>('ledger-app-holdings', () => ({class:
        ctx.exports.LedgerHoldingsGatekeeper({props: {ledgerKey: 'Member@example.com'}})}));
      const fixture = new Queue(); using queue = new RpcStub(fixture);
      using reader = await editor.startSession(queue);
      using points = await holdings.startSession(queue);
      expect((await reader.listEntries()).rows[0].raw_text).toBe('Member@example.com');
      expect(fixture.reads).toBe(1);
      expect(await points.currentHoldings()).toEqual({asOf: 20260906, accounts: [], balances: []});
      let error = '';
      try { await reader.replaceBuffer({knownIds: [], buffer: ''}); } catch (caught) { error = String(caught); }
      expect(error).toContain('Browser Save only');
    }
  });
}, 15_000);

it('uses the browser-only factory for trusted managed output metadata', async () => {
  const user = env.TEST_USER.getByName(crypto.randomUUID());
  await user.authenticateFromCfAccess('member@example.com', true);
  await user.bindDeploymentIdentity({subject: 'member@example.com', storageKey: 'Member@example.com'});
  await runInDurableObject(user, instance => {
    Object.assign(instance['env'], {DEPLOYMENT_USAGE_POLICY: {
      async beginRun(_key: string, runId: string) { return {allowed: true, runId, expiresAt: Date.now() + 10_000}; },
      async reserve() { return {allowed: true}; }, async finishRun() {}, async settleTokens() {},
    }});
  });
  try { await runInDurableObject(env.TEST_OVERSEER.getByName(crypto.randomUUID()), async (instance, ctx) => {
    const impl = instance['impl'];
    impl.ownerId = user.id.toString(); impl.users = env.TEST_USER;
    const required = instance['env'].DEPLOYMENT_USAGE_REQUIRED;
    instance['env'].DEPLOYMENT_USAGE_REQUIRED = 'true';
    try {
    impl.storage.gadgets.put({type: 'gadget', id: 3, title: 'Ledger', created: new Date(0),
      bindingName: 'LEDGER_UI', bindings: {LEDGER: {target: 4}}, systemOutput: 'ledger',
      output: {id: 'ledger', noun: 'Ledger', plural: 'Ledgers', icon: 'table'}});
    impl.storage.gatekeepers.put({id: 4, resourceTitle: 'Ledger',
      class: ctx.exports.LedgerEditorGatekeeper({props: {ledgerKey: 'Member@example.com'}}),
      systemResource: {type: 'ledger', identityKey: 'Member@example.com'}});
    using browser = await impl.getGadgetUiSession(3);
    expect((await browser.listEntries()).rows[0].raw_text).toBe('Member@example.com');
    expect(await browser.replaceBuffer({knownIds: [], buffer: ''})).toEqual({savedBy: 'Member@example.com'});
    impl.storage.gatekeepers.delete(4);
    await expect(impl.getGadgetUiSession(3)).rejects.toThrow('UI binding is unavailable');
    } finally { instance['env'].DEPLOYMENT_USAGE_REQUIRED = required; }
  }); } finally { await runInDurableObject(user, instance => { delete instance['env'].DEPLOYMENT_USAGE_POLICY; }); }
}, 15_000);
