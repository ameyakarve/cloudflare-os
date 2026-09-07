import { describe, expect, it } from 'vitest';
import { env, RpcStub, RpcTarget } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import type { DeploymentSpecialists, SpecialistRecord } from '@gadgets/workshop-shared/specialists';
import type { OverseerDurableObject } from '../src/overseer';
import type { ModelHandle } from '../src/ai-models';
import { zeroUsage } from '../src/ai-invoke';
import { UsageScope } from '../src/deployment-usage';
import type { DeploymentUsage, DeploymentUsageRun, UsageGrant } from '@gadgets/workshop-shared/deployment-usage';

class RootAllowance extends RpcTarget implements DeploymentUsageRun {
  finished = false;
  reservations: DeploymentUsage[] = [];
  grant: UsageGrant = {allowed: true, runId: crypto.randomUUID(), expiresAt: Date.now() + 10_000};
  async getGrant() { return this.grant; }
  async reserve(usage: DeploymentUsage) {
    if (this.finished || Date.now() >= this.grant.expiresAt) throw new Error('expired');
    this.reservations.push(usage); return crypto.randomUUID();
  }
  async settleTokens() {}
  async finish() { this.finished = true; }
}

import { parseSpecialists, SpecialistDispatcher, specialistData } from '../src/specialists';

const nativeLoader = env.LOADER;

const config: DeploymentSpecialists = {version: 1, profiles: [{id: 'research', name: 'Research',
  instructions: 'Read the declared data. Do not fabricate results.', maxTurns: 2,
  intents: [{id: 'read', description: 'Read current data', bindings: {DATA: ['current']}}]}]};

describe('specialist configuration and RPC membrane', () => {
  it('is opt-in and accepts bounded deployment-owned profiles', () => {
    expect(parseSpecialists().profiles).toEqual([]);
    expect(parseSpecialists(JSON.stringify(config))).toEqual(config);
    for (const change of [{maxTurns: 13}, {id: ''}, {intents: []}]) {
      expect(() => parseSpecialists(JSON.stringify({...config,
        profiles: [{...config.profiles[0], ...change}]}))).toThrow();
    }
    for (const method of ['constructor', 'getSession', 'spawn', 'fetch', '__proto__']) {
      const bad = structuredClone(config); bad.profiles[0].intents[0].bindings.DATA = [method];
      expect(() => parseSpecialists(JSON.stringify(bad))).toThrow();
    }
  });

  it('reassembles bounded UTF-8 chunks and rejects malformed transport', () => {
    const unicode = structuredClone(config);
    unicode.profiles[0].instructions = '研究💳'.repeat(1000);
    const json = JSON.stringify(unicode);
    const chunks: string[] = [''];
    for (const char of json) {
      if (new TextEncoder().encode(chunks.at(-1)! + char).length > 4000) chunks.push('');
      chunks[chunks.length - 1] += char;
    }
    const vars = Object.fromEntries(chunks.map((chunk, i) => [`DEPLOYMENT_SPECIALISTS_${i}`, chunk]));
    const manifest = `@chunks:${chunks.length}`;
    expect(parseSpecialists(manifest, vars)).toEqual(unicode);
    expect(parseSpecialists(JSON.stringify(config))).toEqual(config);
    for (const count of ['0', '17', '-1', '01', '1.5', 'NaN', '2x', '']) {
      expect(() => parseSpecialists(`@chunks:${count}`, vars)).toThrow();
    }
    for (const value of [undefined, '', 123, '💳'.repeat(1001)]) {
      expect(() => parseSpecialists(manifest, {...vars, DEPLOYMENT_SPECIALISTS_0: value})).toThrow();
    }
    expect(() => parseSpecialists('@chunks:1', vars)).toThrow();
    expect(() => parseSpecialists('@chunks:1', {DEPLOYMENT_SPECIALISTS_0: '{'})).toThrow();
    expect(() => parseSpecialists('@chunks:1', {DEPLOYMENT_SPECIALISTS_0: '{}'})).toThrow();
    const sixteen = Object.fromEntries(Array.from({length: 16}, (_, i) =>
      [`DEPLOYMENT_SPECIALISTS_${i}`, i === 15 ? JSON.stringify(config) : ' ']));
    expect(parseSpecialists('@chunks:16', sixteen)).toEqual(config);
  });

  it('revokes native calls already waiting for session acquisition', async () => {
    let release!: () => void;
    let started!: () => void;
    const acquired = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    let effects = 0;
    const dispatcher = new SpecialistDispatcher({DATA: ['current']}, new AbortController().signal,
      async (_binding, _method, _args, assertLive) => {
        started(); await acquired; assertLive(); effects++; return null;
      });
    using stub = new RpcStub(dispatcher);
    const pending = Promise.resolve(stub.invoke('DATA', 'current', []));
    const rejected = expect(pending).rejects.toThrow('execution ended');
    await entered;
    dispatcher[Symbol.dispose]();
    release();
    await rejected;
    expect(effects).toBe(0);
  });

  it('restricts native RPC at runtime, rejects returned capabilities, and revokes retained stubs', async () => {
    let calls = 0;
    const control = new AbortController();
    const dispatcher = new SpecialistDispatcher({DATA: ['current']}, control.signal,
      async () => { calls++; return {value: 42}; });
    using stub = new RpcStub(dispatcher);
    expect(await stub.invoke('DATA', 'current', [])).toEqual({value: 42});
    await expect((async () => await stub.invoke('DATA', 'write', []))()).rejects.toThrow('denied');
    await expect((async () => await stub.invoke('OTHER', 'current', []))()).rejects.toThrow('denied');
    await expect((async () => await stub.invoke('constructor', 'current', []))()).rejects.toThrow('denied');
    await expect((async () => await stub.invoke('DATA', 'current', [new RpcTarget()]))()).rejects.toThrow();
    expect(calls).toBe(1);
    dispatcher[Symbol.dispose]();
    await expect((async () => await stub.invoke('DATA', 'current', []))()).rejects.toThrow('denied');
    const leaks = new SpecialistDispatcher({DATA: ['current']}, control.signal, async () => new RpcTarget());
    using leakyStub = new RpcStub(leaks);
    await expect((async () => await leakyStub.invoke('DATA', 'current', []))()).rejects.toThrow('plain data');
  });

  it('rejects overlapping calls and does not deliver a late result after root cancellation', async () => {
    const control = new AbortController();
    let release!: (value: unknown) => void;
    using dispatcher = new SpecialistDispatcher({DATA: ['current']}, control.signal,
      () => new Promise(resolve => { release = resolve; }));
    const pending = dispatcher.invoke('DATA', 'current', []);
    await expect(dispatcher.invoke('DATA', 'current', [])).rejects.toThrow('denied');
    control.abort(new Error('cancelled'));
    release({late: true});
    await expect(pending).rejects.toThrow('cancelled');
  });

  it('refuses a resumed allowance with a replaced identity or deadline', async () => {
    const allowance = new RootAllowance();
    await expect(UsageScope.open(new RpcStub(allowance), {...allowance.grant,
      expiresAt: allowance.grant.expiresAt - 1})).rejects.toThrow('expired run');
    await expect(UsageScope.open(new RpcStub(allowance), {...allowance.grant,
      runId: 'different'})).rejects.toThrow('expired run');
    expect(allowance.finished).toBe(false);
  });

  it('stops calls after cancellation and bounds sequential calls and data', async () => {
    let calls = 0;
    const control = new AbortController();
    using dispatcher = new SpecialistDispatcher({DATA: ['current']}, control.signal, async () => ++calls);
    for (let i = 0; i < 32; i++) await dispatcher.invoke('DATA', 'current', []);
    await expect(dispatcher.invoke('DATA', 'current', [])).rejects.toThrow('denied');
    control.abort(new Error('root stopped'));
    await expect(dispatcher.invoke('DATA', 'current', [])).rejects.toThrow('root stopped');
    expect(() => specialistData({f: () => {}})).toThrow();
    expect(() => specialistData('x'.repeat(32_769))).toThrow('too large');
    const oversizedSparse: unknown[] = [];
    oversizedSparse.length = 10_001;
    expect(() => specialistData(oversizedSparse)).toThrow('array too complex');
    const accessor: unknown[] = [];
    Object.defineProperty(accessor, '0', {get() { throw new Error('must not execute'); }});
    expect(() => specialistData(accessor)).toThrow('array accessor');
    const sparse: unknown[] = [];
    sparse.length = 2;
    sparse[1] = 1;
    expect(specialistData(sparse)).toEqual([null, 1]);
    const cycle: unknown[] = []; cycle.push(cycle);
    expect(() => specialistData(cycle)).toThrow('complex');
  });
});

it('retains completed evidence and marks orphan preparations unknown after an actual DO restart', async () => {
  const stub = env.TEST_OVERSEER.getByName(crypto.randomUUID());
  await runInDurableObject(stub, async (instance: OverseerDurableObject) => {
    const storage = instance['impl'].storage;
    const now = Date.now();
    const root: SpecialistRecord = {id: 'root', rootId: 'root', rootChatId: 1,
      kind: 'root', status: 'running', createdAt: now, updatedAt: now};
    storage.specialistRecords.put(root);
    storage.specialistRecords.put({...root, id: 'code', kind: 'code', status: 'prepared',
      childChatId: 2, parentId: 'root', source: 'export default () => 42'});
    storage.specialistRecords.put({...root, id: 'call', kind: 'call', status: 'completed',
      childChatId: 2, parentId: 'code', result: '{"value":42}'});
    await instance['ctx'].storage.sync();
  });
  try {
    await runInDurableObject(stub, (_instance, ctx) => ctx.abort('test specialist restart'));
  } catch { /* abort closes the outstanding request */ }
  await runInDurableObject(env.TEST_OVERSEER.get(stub.id), async (instance: OverseerDurableObject) => {
    const storage = instance['impl'].storage;
    expect(storage.specialistRecords.get('root')?.status).toBe('unknown');
    expect(storage.specialistRecords.get('code')?.status).toBe('unknown');
    expect(storage.specialistRecords.get('code')?.source).toBe('export default () => 42');
    expect(storage.specialistRecords.get('call')?.status).toBe('completed');
    expect(storage.specialistRecords.get('call')?.result).toBe('{"value":42}');
    expect([...storage.specialistRecords.unfinished.list()]).toEqual([]);
  });
});

function fakeModel(inspect: (context: Parameters<ModelHandle['stream']>[1]) => void | AssistantMessage['content']): ModelHandle {
  return {model: {api: 'openai-completions', provider: 'openai', id: 'fixture', name: 'Fixture',
    baseUrl: 'https://never-called.invalid', input: ['text'], reasoning: false,
    contextWindow: 128_000, maxTokens: 1000, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}},
    stream(model, context) {
      const content = inspect(context) ?? [{type: 'text' as const, text: 'Bounded research result'}];
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = {role: 'assistant', api: model.api, provider: model.provider,
        model: model.id, content,
        stopReason: content.some(c => c.type === 'toolCall') ? 'toolUse' : 'stop', timestamp: Date.now(), usage: zeroUsage()};
      stream.push({type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message}); stream.end(); return stream;
    }};
}

it.each(['answer', 'code', 'ambiguous', 'approval', 'native', 'detached-session', 'detached-running', 'startup', 'cancel-running', 'loader-startup', 'loader-get-cancel'] as const)(
    'runs a real %s child loop with durable linkage and restricted tools', async mode => {
  const stub = env.TEST_OVERSEER.getByName(crypto.randomUUID());
  await runInDurableObject(stub, async (instance: OverseerDurableObject) => {
    const impl = instance['impl'];
    Object.defineProperty(impl.env, 'LOADER', {configurable: true, value: nativeLoader});
    impl.env.DEPLOYMENT_SPECIALISTS = JSON.stringify(config);
    impl.getInstanceInstructions = async () => '';
    const rootChat = impl.nextChatId();
    impl.storage.chatMeta.put({id: rootChat, title: 'Root', started: new Date(), lastActive: new Date()});
    const author = {type: 'user' as const, id: 'fixture@example.com', name: 'Fixture'};
    const aiModel = {profile: {type: 'agent' as const, id: 'fixture', name: 'Fixture'},
      config: {provider: 'openai' as const, model: 'gpt-4.1', apiToken: 'never-used'}};
    // Only a marker is required for the binding: the model does not execute RPC in this test.
    impl.storage.gatekeepers.put({id: 999, class: instance['ctx'].exports.IdentityTestGatekeeper({props: {}}),
      resourceTitle: 'Data', creationSpec: {type: 'ambient', vendorId: 'fixture'}});
    const allowance = new RootAllowance();
    await using scope = await UsageScope.open(new RpcStub(allowance));
    impl.env.DEPLOYMENT_USAGE_REQUIRED = 'true';
    const live = {cancelController: new AbortController(), activeAgentCallbacks: new Map(),
      pendingAgentCallbacks: [], usageScope: scope};
    let methodCalls = 0;
    let disposed = 0;
    let startupRuns = 0;
    let release!: () => void;
    const delay = new Promise<void>(resolve => { release = resolve; });
    const detached = mode === 'detached-session' || mode === 'detached-running';
    const interrupted = mode === 'cancel-running' || mode === 'loader-startup' || mode === 'loader-get-cancel';
    impl.startGatekeeperSession = async (_target, caller) => {
      if (mode === 'detached-session') await delay;
      return {[Symbol.dispose]() { disposed++; }, current: async () => {
      await using borrowed = await UsageScope.open((await impl.getUsageBudget(caller))!);
      expect(borrowed.grant).toEqual(allowance.grant);
      await borrowed.reserve({capabilityCalls: 1});
      methodCalls++;
      expect([...impl.storage.specialistRecords.list()].some(r => r.kind === 'call' && r.status === 'running')).toBe(true);
      if (mode === 'detached-running' || mode === 'cancel-running') await delay;
      if (mode === 'ambiguous') throw new Error('acknowledgement lost');
      if (mode === 'approval') await impl.submitAction(999, 1, {
        title: 'Proposed edit', description: 'Fixture proposal', implementsRevert: false,
        awaitDecision: true,
      }, caller, borrowed);
      return {value: 42};
    }};
    };
    if (mode === 'loader-startup' || mode === 'loader-get-cancel') Object.defineProperty(impl.env, 'LOADER', {configurable: true, value: {
      load() { return {getEntrypoint() {
        if (mode === 'loader-get-cancel') live.cancelController.abort(new Error('fixture deadline'));
        return {verify: () => delay, run() { startupRuns++; }};
      }}; },
    }});
    if (['answer', 'code', 'ambiguous', 'approval'].includes(mode)) Object.defineProperty(impl.env, 'LOADER', {configurable: true, value: {
      load(def: WorkerLoaderWorkerCode) {
        expect(def.env).toEqual({});
        expect(def.globalOutbound).toBeNull();
        expect([...impl.storage.specialistRecords.list()].some(r => r.kind === 'code' && r.status === 'prepared')).toBe(true);
        return {getEntrypoint() { return {
          verify() {},
          async run(self: unknown, callbacks: unknown, forger: unknown, dispatcher: SpecialistDispatcher) {
            expect(self).toBeUndefined(); expect(callbacks).toBeUndefined(); expect(forger).toBeUndefined();
            try { await dispatcher.invoke('DATA', 'current', []); }
            finally {
              // Simulated loader only; use the real tail entrypoint and record collection.
              await (def.tails![0] as Fetcher & {tail(events: unknown[]): Promise<void>}).tail([
                {logs: [{message: ['fixture output'], level: 'log', timestamp: Date.now()}],
                  exceptions: [], event: {rpcMethod: 'run'}}]);
            }
          },
        }; }};
      },
    }});
    let modelCalls = 0;
    const tools = impl.specialistTools(rootChat, aiModel, fakeModel(context => {
      modelCalls++;
      if ((mode === 'code' || mode === 'native') && modelCalls === 2) {
        expect(context.messages.at(-1), JSON.stringify(context.messages.at(-1))).not.toHaveProperty('isError', true);
      }
      expect(context.tools?.map(t => t.name).toSorted()).toEqual(['describeBinding', 'executeCode']);
      expect(context.systemPrompt).toContain(config.profiles[0].instructions);
      expect(context.systemPrompt).not.toContain('self is a magic object');
      const records = [...impl.storage.specialistRecords.list()];
      expect(records.some(r => r.kind === 'delegation' && r.status === 'running')).toBe(true);
      if (mode !== 'answer' && modelCalls === 1) return [{type: 'toolCall', id: 'code-1',
        name: 'executeCode', arguments: {code: mode === 'startup'
          ? 'await new Promise(resolve => setTimeout(resolve, 60000)); export default () => {}'
          : detached
            ? 'export default async (_, env) => { env.DATA.current().catch(() => {}); await new Promise(resolve => setTimeout(resolve, 20)); }'
            : 'export default async (_, env) => await env.DATA.current()'}}];
    }), author, live)!;
    const timer = interrupted ? setTimeout(() => live.cancelController.abort(new Error('fixture deadline')), 200) : undefined;
    const delegation = tools.delegate('research', 'read', 'Read data', {DATA: {type: 'workpiece', id: 999}});
    if (interrupted) {
      try { await expect(delegation).rejects.toThrow('fixture deadline'); }
      finally { clearTimeout(timer); release(); }
      await scheduler.wait(20);
      const records = [...impl.storage.specialistRecords.list()];
      expect(records.find(r => r.kind === 'code')?.status).toBe('unknown');
      expect(records.find(r => r.kind === 'delegation')?.status).toBe('unknown');
      expect(methodCalls).toBe(mode === 'cancel-running' ? 1 : 0);
      expect(startupRuns).toBe(0);
      if (mode === 'cancel-running') expect(records.find(r => r.kind === 'call')?.status).toBe('unknown');
      return;
    }
    const output: SpecialistRecord = JSON.parse(await delegation);
    if (mode === 'startup') {
      // workerd rejects top-level timer I/O itself; the simulated verify test covers a stall.
      expect(output.status).toBe('unknown');
      expect(methodCalls).toBe(0);
      return;
    }
    if (detached) {
      expect(output.status).toBe('unknown');
      expect(methodCalls).toBe(mode === 'detached-session' ? 0 : 1);
      expect([...impl.storage.specialistRecords.list()].filter(r => r.kind === 'call' || r.kind === 'code')
        .map(r => r.status)).toEqual(['unknown', 'unknown']);
      release();
      await scheduler.wait(20);
      expect(disposed).toBe(1);
      expect(methodCalls).toBe(mode === 'detached-session' ? 0 : 1);
      expect([...impl.storage.specialistRecords.list()].find(r => r.kind === 'call')?.status).toBe('unknown');
      await expect(tools.delegate('research', 'read', 'Retry', {DATA: {type: 'workpiece', id: 999}}))
        .rejects.toThrow('blocked');
      return;
    }
    expect(modelCalls).toBe(mode === 'answer' || mode === 'approval' ? 1 : 2);
    expect(methodCalls).toBe(mode === 'answer' ? 0 : 1);
    expect(output.status).toBe(mode === 'ambiguous' ? 'unknown' : mode === 'approval' ? 'pending-approval' : 'completed');
    if (mode !== 'approval') expect(output.result).toBe('Bounded research result');
    expect(output.usageRunId).toBe(allowance.grant.runId);
    expect(output.expiresAt).toBe(allowance.grant.expiresAt);
    expect(allowance.finished).toBe(false);
    await scope.reserve({capabilityCalls: 1});
    if (mode === 'approval') {
      const action = impl.storage.actions.get(output.actionIds![0])!;
      expect(action.state).toBe('pending');
      // Simulate a canonical commit confirmation, not a model continuation grant.
      action.state = 'approved'; impl.storage.actions.put(action);
      expect(JSON.parse(tools.read(output.id)).actions[0].state).toBe('approved');
      expect(modelCalls).toBe(1);
    }
    expect(output.rootChatId).toBe(rootChat);
    expect(output.childChatId).not.toBe(rootChat);
    expect(impl.storage.chatContext.get(output.childChatId!)?.specialist?.delegationId).toBe(output.id);
    expect(impl.storage.chatMeta.get(output.childChatId!)?.activeAgent).toBeUndefined();
    expect(live.cancelController.signal.aborted).toBe(false);
    expect(JSON.parse(tools.read(output.id)).source).toBe('Read data');
    expect(JSON.parse(tools.list()).length).toBe(mode === 'answer' ? 2 : 4);
    expect(() => tools.read('foreign-record')).toThrow();
    await expect(impl.executeCodeMode(output.childChatId!, 'export default () => {}', author,
      'fixture', {})).rejects.toThrow('expired');
    await expect(tools.delegate('research', 'read', 'Read data', {})).rejects.toThrow(
      mode === 'ambiguous' || mode === 'approval' ? 'blocked' : 'unavailable');
    if (mode === 'answer') {
      impl.storage.specialistRecordCount.put(2000);
      const later = impl.specialistTools(rootChat, aiModel, fakeModel(() => {
        throw new Error('must not dispatch at capacity');
      }), author, live)!;
      expect(JSON.parse(later.read(output.id)).id).toBe(output.id);
      await expect(later.delegate('research', 'read', 'Read data', {DATA: {type: 'workpiece', id: 999}}))
        .rejects.toThrow('limit reached');
    }
    live.cancelController.abort(new Error('root cancelled'));
    await expect(tools.delegate('research', 'read', 'Read data', {DATA: {type: 'workpiece', id: 999}}))
      .rejects.toThrow('root cancelled');
  });
});
