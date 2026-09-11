import { env, RpcStub, RpcTarget } from 'cloudflare:workers';
import { abortAllDurableObjects, runInDurableObject } from 'cloudflare:test';
import { expect, it, vi } from 'vitest';
import { UsageScope } from '../src/deployment-usage.js';
import type { DeploymentUsageRun } from '@gadgets/workshop-shared/deployment-usage';
import { createAssistantMessageEventStream, type Api, type Model, type SimpleStreamOptions, type StreamFunction } from '@earendil-works/pi-ai';
import { streamWithUsage } from '../src/model-usage.js';

const author = {type: 'user' as const, id: 'synthetic', name: 'Synthetic'};
const model = {profile: {type: 'agent' as const, id: 'fixture', name: 'Fixture'},
  config: {provider: 'openai' as const, model: 'gpt-4.1', apiToken: 'never-used'}};
const row = {chatId: 7, initiatorUserId: 'invalid-do-id-no-service-call', modelId: 'fixture',
  initiator: author, callbackInitiated: false};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return {promise, resolve};
}

it('durably stops legacy/no-controller rows, repeats idempotently, and never recovers them after actual DO abort', async () => {
  const name = crypto.randomUUID();
  let executionId: string | undefined;
  await runInDurableObject(env.TEST_OVERSEER.getByName(name), async instance => {
    const impl = instance['impl'];
    impl.storage.activeAgents.put(row);
    impl.storage.chatMeta.put({id: 7, title: 'Synthetic', started: new Date(), lastActive: new Date(), activeAgent: model.profile});
    await impl.cancelAgent(7);
    executionId = impl.storage.activeAgents.get(7)?.executionId;
    expect(executionId).toBeTruthy();
    await impl.cancelAgent(7);
    expect(impl.storage.activeAgents.get(7)).toMatchObject({executionId, stopRequested: true});
  });
  await abortAllDurableObjects();
  await runInDurableObject(env.TEST_OVERSEER.getByName(name), async instance => {
    const impl = instance['impl'];
    // Attempted recovery would reject the invalid DO ID, remove this record and post a model error.
    expect(impl.storage.activeAgents.get(7)).toMatchObject({executionId, stopRequested: true});
    expect(impl.storage.chatMeta.get(7)?.activeAgent).toBeUndefined();
    expect([...impl.storage.chats.list()]).toHaveLength(0);
    await impl.waitForAllAgentsToComplete();
  });
});

it('reopens real SQLite after ACK while actual UsageScope.finish is stalled', async () => {
  const name = crypto.randomUUID();
  await runInDurableObject(env.TEST_OVERSEER.getByName(name), async instance => {
    const impl = instance['impl'];
    const admissionReady = deferred<UsageScope | undefined>();
    const finishing = deferred<void>();
    class SyntheticRun extends RpcTarget implements DeploymentUsageRun {
      async getGrant() { return {allowed: true as const, runId: 'synthetic', expiresAt: Date.now() + 60_000}; }
      async reserve() { throw new Error('No reservation allowed'); }
      async settleTokens() { throw new Error('No settlement expected'); }
      async finish() { finishing.resolve(); await new Promise<void>(() => {}); }
    }
    const scope = await UsageScope.open(new RpcStub(new SyntheticRun()));
    const admission = vi.spyOn(impl, 'newUsageScope').mockReturnValue(admissionReady.promise);
    const errors = vi.spyOn(impl, 'postAgentErrorMessage').mockImplementation(() => {});
    impl.storage.chatMeta.put({id: 7, title: 'Synthetic', started: new Date(), lastActive: new Date(), activeAgent: model.profile});
    impl.startAgent(7, model, author, row.initiatorUserId);
    await impl.cancelAgent(7);
    admissionReady.resolve(scope);
    await finishing.promise;
    expect(impl.storage.chatMeta.get(7)?.activeAgent).toEqual(model.profile);
    expect(impl.storage.activeAgents.get(7)?.stopRequested).toBe(true);
    admission.mockRestore(); errors.mockRestore();
  });
  await abortAllDurableObjects();
  await runInDurableObject(env.TEST_OVERSEER.getByName(name), async instance => {
    const impl = instance['impl'];
    expect(impl.storage.activeAgents.get(7)?.stopRequested).toBe(true);
    expect(impl.storage.chatMeta.get(7)?.activeAgent).toBeUndefined();
    await impl.waitForAllAgentsToComplete();
  });
});

it('deletion unregisters synchronously when the fenced old finalizer no longer owns the row', async () => {
  await runInDurableObject(env.TEST_OVERSEER.getByName(crypto.randomUUID()), async instance => {
    const impl = instance['impl'];
    const ready = deferred<UsageScope | undefined>();
    const admission = vi.spyOn(impl, 'newUsageScope').mockReturnValue(ready.promise);
    let turn: Promise<unknown> | undefined;
    const waitUntil = vi.spyOn(impl.ctx, 'waitUntil').mockImplementation(promise => { turn = promise; });
    try {
      impl.startAgent(7, model, author, row.initiatorUserId, false, true);
      impl.storage.activeAgents.delete(7);
      impl.destroyLiveChat(7);
      await impl.waitForAllAgentsToComplete();
      ready.resolve(undefined);
      await turn;
    } finally { ready.resolve(undefined); admission.mockRestore(); waitUntil.mockRestore(); }
  });
});

it('does not ACK a failed durability barrier', async () => {
  await runInDurableObject(env.TEST_OVERSEER.getByName(crypto.randomUUID()), async (instance, ctx) => {
    const impl = instance['impl'];
    impl.storage.activeAgents.put(row);
    const sync = vi.spyOn(ctx.storage, 'sync').mockRejectedValueOnce(new Error('synthetic flush fault'));
    try {
      await expect(impl.cancelAgent(7)).rejects.toThrow('synthetic flush fault');
      expect(impl.storage.activeAgents.get(7)?.stopRequested).toBe(true);
    } finally { sync.mockRestore(); }
    await impl.cancelAgent(7);
  });
});

it('Stop during grant await cannot restore a stale row; stalled finish retains intent and fences replacement', async () => {
  await runInDurableObject(env.TEST_OVERSEER.getByName(crypto.randomUUID()), async instance => {
    const impl = instance['impl'];
    const grantReady = deferred<UsageScope | undefined>();
    const finishReady = deferred<void>();
    const finishing = deferred<void>();
    class SyntheticRun extends RpcTarget implements DeploymentUsageRun {
      async getGrant() { return {allowed: true as const, runId: 'synthetic', expiresAt: Date.now() + 60_000}; }
      async reserve() { throw new Error('No dispatch/reservation allowed'); }
      async settleTokens() { throw new Error('No settlement expected'); }
      async finish() { finishing.resolve(); await finishReady.promise; }
    }
    const scope = await UsageScope.open(new RpcStub(new SyntheticRun()));
    const admission = vi.spyOn(impl, 'newUsageScope').mockReturnValue(grantReady.promise);
    const errors = vi.spyOn(impl, 'postAgentErrorMessage').mockImplementation(() => {});
    const reconcile = vi.spyOn(impl, 'reconcilePendingGadgets').mockResolvedValue();
    let turn: Promise<unknown> | undefined;
    const waitUntil = vi.spyOn(impl.ctx, 'waitUntil').mockImplementation(promise => { turn = promise; });
    impl.storage.chatMeta.put({id: 7, title: 'Synthetic', started: new Date(), lastActive: new Date(), activeAgent: model.profile});
    try {
      impl.startAgent(7, model, author, row.initiatorUserId, false, true);
      const executionId = impl.storage.activeAgents.get(7)!.executionId;
      await impl.cancelAgent(7);
      grantReady.resolve(scope);
      await finishing.promise;
      expect(impl.storage.activeAgents.get(7)).toMatchObject({executionId, stopRequested: true});
      expect(impl.storage.activeAgents.get(7)?.deploymentUsageRun).toBeUndefined();
      expect(reconcile).not.toHaveBeenCalled(); // no pre-dispatch materialization
      expect(() => impl.startAgent(7, model, author, row.initiatorUserId)).toThrow('still active');
      // Adversarial replacement, not a claim that the public start path permits it.
      impl.storage.activeAgents.put({...row, executionId: 'new-execution'});
      impl.storage.chatMeta.put({id: 7, title: 'New', started: new Date(), lastActive: new Date(), activeAgent: model.profile});
      finishReady.resolve();
      await turn;
      expect(impl.storage.activeAgents.get(7)?.executionId).toBe('new-execution');
      expect(impl.storage.chatMeta.get(7)?.activeAgent).toEqual(model.profile);
      expect(reconcile).not.toHaveBeenCalled();
    } finally {
      finishReady.resolve(); admission.mockRestore(); errors.mockRestore(); reconcile.mockRestore(); waitUntil.mockRestore();
    }
  });
});

it.each(['openai-completions', 'google-generative-ai'] as const)(
  'Stop while %s reservation is pending admits zero synthetic transport dispatches', async api => {
  await runInDurableObject(env.TEST_OVERSEER.getByName(crypto.randomUUID()), async instance => {
    const impl = instance['impl'];
    const reserved = deferred<void>();
    const receipt = deferred<string>();
    const materializing = deferred<void>();
    const materialized = deferred<void>();
    class SyntheticRun extends RpcTarget implements DeploymentUsageRun {
      async getGrant() { return {allowed: true as const, runId: 'synthetic', expiresAt: Date.now() + 60_000}; }
      async reserve() { reserved.resolve(); return receipt.promise; }
      async settleTokens() { throw new Error('No settlement expected'); }
      async finish() {}
    }
    const scope = await UsageScope.open(new RpcStub(new SyntheticRun()));
    const admission = vi.spyOn(impl, 'newUsageScope').mockResolvedValue(scope);
    const errors = vi.spyOn(impl, 'postAgentErrorMessage').mockImplementation(() => {});
    const reconcile = vi.spyOn(impl, 'reconcilePendingGadgets').mockImplementation(async () => {
      materializing.resolve(); await materialized.promise;
    });
    let turn: Promise<unknown> | undefined;
    const waitUntil = vi.spyOn(impl.ctx, 'waitUntil').mockImplementation(promise => { turn = promise; });
    impl.storage.chatMeta.put({id: 7, title: 'Synthetic', started: new Date(), lastActive: new Date(), activeAgent: model.profile});
    let dispatches = 0;
    let providerEntries = 0;
    const fakeModel: Model<Api> = {api, provider: 'openai', id: 'fixture', name: 'Fixture',
      baseUrl: 'https://never-called.invalid', input: ['text'], reasoning: false, contextWindow: 1000, maxTokens: 100,
      cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}};
    let providerDone: Promise<unknown> | undefined;
    const provider: StreamFunction<Api, SimpleStreamOptions> = (_model, _context, options) => {
      providerEntries++;
      const output = createAssistantMessageEventStream();
      providerDone = options!.fetch!(fakeModel.baseUrl).catch(() => {}).finally(() => output.end());
      return output;
    };
    try {
      impl.startAgent(7, model, author, row.initiatorUserId, false, true);
      await materializing.promise; // actual turn owns the same scope; no model has been constructed
      const output = streamWithUsage(provider, fakeModel, {messages: []}, {
        fetch: async () => { dispatches++; return new Response('synthetic'); },
      }, scope);
      await reserved.promise;
      await impl.cancelAgent(7);
      receipt.resolve('late-receipt');
      expect((await output.result()).stopReason).toBe('error');
      await providerDone;
      materialized.resolve();
      await turn;
      expect(dispatches).toBe(0);
      expect(providerEntries).toBe(api === 'google-generative-ai' ? 0 : 1);
      expect(impl.storage.activeAgents.get(7)?.stopRequested).toBe(true);
      expect(impl.storage.chatMeta.get(7)?.activeAgent).toBeUndefined();
    } finally {
      receipt.resolve('late-receipt'); materialized.resolve();
      await turn;
      admission.mockRestore(); errors.mockRestore(); reconcile.mockRestore(); waitUntil.mockRestore();
    }
  });
});
