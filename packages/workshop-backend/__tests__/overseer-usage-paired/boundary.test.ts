import {afterEach, expect, it, vi} from 'vitest';
import {env, RpcStub} from 'cloudflare:workers';
import {abortAllDurableObjects, runInDurableObject, runDurableObjectAlarm} from 'cloudflare:test';
import type {OverseerDurableObject} from '../../src/overseer.js';
import type {UserDurableObject} from '../../src/user.js';
import type {AccessState} from '../user-usage-v2/worker.js';
import type {PairedOverseerProbe} from './worker.js';
import {UsageScope} from '../../src/deployment-usage.js';

declare global { namespace Cloudflare { interface Env {
  TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>;
  TEST_PAIRED_PROBE: DurableObjectNamespace<PairedOverseerProbe>;
  TEST_USER_V2: DurableObjectNamespace<UserDurableObject>;
  ACCESS_STATE: DurableObjectNamespace<AccessState>;
  CANONICAL_INSPECT: Fetcher;
} } }
afterEach(() => vi.restoreAllMocks());
async function refused(operation: () => Promise<unknown>) {
  let failed = false;
  try { await operation(); } catch { failed = true; }
  expect(failed).toBe(true);
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const execution = {chat: 7, id: 'original-execution'};
async function fixture(probe = false) {
  const key = `Paired.${crypto.randomUUID()}@example.test`;
  const user = env.TEST_USER_V2.getByName(key);
  await user.authenticateFromCfAccess(key.toLowerCase(), true);
  await user.bindDeploymentIdentity({subject: key.toLowerCase(), storageKey: key});
  const overseer = (probe ? env.TEST_PAIRED_PROBE : env.TEST_OVERSEER).getByName(key);
  await runInDurableObject(overseer, instance => {
    const impl = instance['impl'];
    // Match production's ctx.exports namespace with this fixture's real User binding.
    impl.users = env.TEST_USER_V2;
    impl.ownerId = user.id.toString(); impl.storage.ownerId.put(impl.ownerId);
    impl.storage.activeAgents.put({chatId: execution.chat, executionId: execution.id,
      initiatorUserId: user.id.toString(), modelId: 'unused', initiator: {type: 'agent', id: 'fixture', name: 'Fixture'}, callbackInitiated: false});
  });
  return {key, user, overseer};
}
async function inspect(key: string) {
  return (await env.CANONICAL_INSPECT.fetch(`https://fixture.test/?key=${encodeURIComponent(key)}`)).json<{
    runs: {id: string; finished: number; expires_at: number}[]; slots: {state: string; exact_generation: string}[];
    daily: {usage: string}[]; receipts: unknown[];
  }>();
}
async function fault(key: string, value: object) {
  await env.CANONICAL_INSPECT.fetch(`https://fixture.test/?key=${encodeURIComponent(key)}`, {method: 'POST', body: JSON.stringify(value)});
}
async function open(impl: OverseerDurableObject['impl'], site: string) {
  if (site !== 'agent') return UsageScope.open((await impl.getUsageBudget({from: 'hook'}))!);
  const scope = (await impl.newUsageScope(undefined, execution))!;
  // Mirror the actual agent caller's post-return grant persistence (not acquisition decisions).
  const record = impl.storage.activeAgents.get(execution.chat)!;
  record.deploymentUsageRun = scope.grant; impl.storage.activeAgents.put(record);
  return scope;
}

it.each(['agent', 'control'])('actual %s site → actual User → real M, fenced root, borrowing and settlement after closure', async site => {
  const {key, overseer} = await fixture();
  await runInDurableObject(overseer, async instance => {
    const impl = instance['impl'];
    await using scope = await open(impl, site);
    const original = scope.grant;
    const record = impl.usageLifecycle.journal.records()[0];
    expect(record.state).toBe('adopted');
    expect(record.remote?.deployment).toBe('UserDurableObject');
    expect(JSON.parse(record.remote!.ticket)).toMatchObject({issuedAt: record.intent.issuedAt, acquireBy: record.intent.issuedAt + 5000});
    const receipt = await scope.reserve({tokens: 10});
    using borrowed = new RpcStub(scope.borrow());
    await borrowed.finish();
    expect(await scope.run.getGrant()).toEqual(original);
    await scope.run.finish();
    await scope.run.settleTokens(receipt, 4);
    await refused(async () => await scope.run.reserve({externalRequests: 1}));
    expect(impl.usageLifecycle.journal.records()).toHaveLength(0);
  });
  const state = await inspect(key);
  expect(state.runs).toHaveLength(1); expect(state.runs[0].finished).toBe(1);
  expect(JSON.parse(state.daily[0].usage)).toMatchObject({capabilityCalls: 1, tokens: 4});
});

it.each(['agent', 'control'])('actual %s site refuses owner ABA during every authority boundary', async site => {
  for (const method of ['snapshot', 'begin', 'activate', 'grant']) {
    const {key, overseer} = await fixture();
    await fault(key, {method, delay: 180});
    await runInDurableObject(overseer, async instance => {
      const impl = instance['impl'];
      const pending = open(impl, site).then(async scope => { await scope[Symbol.asyncDispose](); return false; }, () => true);
      await sleep(60);
      const owner = impl.ownerId; impl.ownerId = 'replacement'; impl.ownerId = owner;
      expect(await pending).toBe(true);
      await impl.usageLifecycle.drain();
    });
    const state = await inspect(key);
    expect(state.receipts).toHaveLength(0);
    expect(state.runs.every(r => r.finished === 1)).toBe(true);
    expect(state.runs.length).toBeLessThanOrEqual(1);
  }
});

it.each(['agent', 'control'])('actual %s site loses the final User root reply, but retains exact cleanup before adoption', async site => {
  const {key, user, overseer} = await fixture();
  await runInDurableObject(user, instance => {
    const original = instance.adoptDeploymentUsageAcquisitionV2.bind(instance);
    vi.spyOn(Object.getPrototypeOf(instance) as UserDurableObject, 'adoptDeploymentUsageAcquisitionV2').mockImplementation(async ticket => {
      const root = await original(ticket);
      // Actual M has activated; drop the actual User root, not a synthetic grant.
      expect((await inspect(key)).slots.some(s => s.state === 'active')).toBe(true);
      using _dropped = new RpcStub(root);
      throw new Error('synthetic lost final root reply');
    });
  });
  await runInDurableObject(overseer, async instance => {
    await expect(open(instance['impl'], site)).rejects.toThrow();
    expect(instance['impl'].usageLifecycle.journal.records()).toHaveLength(0);
  });
  const state = await inspect(key);
  expect(state.runs).toHaveLength(1); expect(state.runs[0].finished).toBe(1);
  expect(JSON.parse(state.daily[0].usage).capabilityCalls).toBe(1);
});

it.each(['agent', 'control'])('actual %s site cannot publish after its original five seconds, including role time', async site => {
  const {key, overseer} = await fixture();
  await runInDurableObject(overseer, async instance => {
    const impl = instance['impl'];
    const original = impl.checkDeploymentAccess.bind(impl);
    const access = vi.spyOn(impl, 'checkDeploymentAccess').mockImplementation(async (...args) => {
      await sleep(5100); return original(...args);
    });
    try { await expect(open(impl, site)).rejects.toThrow(); }
    finally { access.mockRestore(); }
    expect(impl.usageLifecycle.journal.records()).toHaveLength(0);
  });
  expect((await inspect(key)).runs).toHaveLength(0);
});

it('Stop during activation closes the creation-owned execution, never a replacement; old roots cannot dispatch', async () => {
  const {key, overseer} = await fixture();
  await fault(key, {method: 'activate', delay: 200});
  await runInDurableObject(overseer, async instance => {
    const impl = instance['impl'];
    const pending = open(impl, 'agent').then(async s => { await s[Symbol.asyncDispose](); return false; }, () => true);
    await sleep(80); await impl.cancelAgent(execution.chat);
    expect(await pending).toBe(true);
    impl.storage.activeAgents.put({...impl.storage.activeAgents.get(execution.chat)!, executionId: 'replacement', stopRequested: false});
    expect(impl.usageLifecycle.journal.records().every(r => r.state === 'cleaning')).toBe(true);
  });
  expect((await inspect(key)).runs.every(r => r.finished === 1)).toBe(true);
});

it.each(['grant', 'reserve'])('owner/Stop checks reject late root %s replies while allowing only known original settlement', async method => {
  const {key, overseer} = await fixture();
  await runInDurableObject(overseer, async instance => {
    const impl = instance['impl'];
    await using scope = await open(impl, 'agent');
    const receipt = await scope.reserve({tokens: 10});
    await fault(key, {method, delay: 200});
    const pending = (method === 'grant' ? scope.run.getGrant() : scope.run.reserve({externalRequests: 1})).then(() => false, () => true);
    await sleep(60); await impl.cancelAgent(execution.chat);
    expect(await pending).toBe(true);
    await scope.run.settleTokens(receipt, 3);
    await refused(async () => await scope.run.settleTokens('not-owned', 3));
  });
  expect((await inspect(key)).runs).toHaveLength(1);
});

it('cleanup failure and lost terminal ack survive real Overseer eviction and shared alarm retry on original route', async () => {
  const {key, overseer, user} = await fixture();
  await runInDurableObject(overseer, async (instance, ctx) => {
    const impl = instance['impl'];
    await using scope = await open(impl, 'control');
    // User cancellation unavailable: durable upstream obligation cannot be cleared.
    impl.users = undefined!;
    await scope.run.finish();
    const record = impl.usageLifecycle.journal.records()[0];
    expect(record.state).toBe('cleaning'); expect(record.remote?.owner).toBe(user.id.toString());
    impl.storage.activeAgents.delete(execution.chat);
    await impl.updateSharedAlarm();
    expect(await ctx.storage.getAlarm()).toBe(record.retryAt);
  });
  await abortAllDurableObjects();
  const reopened = env.TEST_OVERSEER.getByName(key);
  await runInDurableObject(reopened, instance => { instance['impl'].users = env.TEST_USER_V2; });
  await sleep(1100); await runDurableObjectAlarm(reopened);
  await runInDurableObject(reopened, instance => { expect(instance['impl'].usageLifecycle.journal.records()).toHaveLength(0); });
  expect((await inspect(key)).runs[0].finished).toBe(1);
});

it('adopted agent lookup uses exact persisted run and execution without replacement; healthy role renewal preserves TTL', async () => {
  const {key, overseer} = await fixture();
  await runInDurableObject(overseer, async instance => {
    const impl = instance['impl'];
    await using scope = await open(impl, 'agent');
    await env.ACCESS_STATE.getByName(key).set({ttl: 1000});
    await using resumed = (await impl.newUsageScope(scope.grant, execution))!;
    expect(resumed.grant).toEqual(scope.grant);
    await resumed.reserve({externalRequests: 1});
    await expect(impl.newUsageScope({...scope.grant, expiresAt: scope.grant.expiresAt + 1}, execution)).rejects.toThrow();
    await expect(impl.newUsageScope(scope.grant, {...execution, id: 'replacement'})).rejects.toThrow();
  });
  expect((await inspect(key)).runs).toHaveLength(1);
});

it.each(['agent', 'control'])('every local arm and role await at %s rejects cancelled continuations before new authority', async site => {
  for (const stage of ['role', 'digest', 'arm1', 'arm2', 'arm3', 'arm4']) {
    const {key, overseer} = await fixture();
    await runInDurableObject(overseer, async instance => {
      const impl = instance['impl'];
      const journal = impl.usageLifecycle.journal;
      let count = 0;
      const cancel = () => {
        for (const r of journal.records()) journal.close(r, Date.now());
      };
      const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
      const digest = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => {
        const result = await originalDigest(...args);
        if (stage === 'digest') cancel();
        return result;
      });
      const originalArm = journal.arm.bind(journal);
      const arm = vi.spyOn(journal, 'arm').mockImplementation(async () => {
        await originalArm();
        if (stage === `arm${++count}`) cancel();
      });
      const originalAccess = impl.checkDeploymentAccess.bind(impl);
      const access = vi.spyOn(impl, 'checkDeploymentAccess').mockImplementation(async (...args) => {
        const grant = await originalAccess(...args);
        if (stage === 'role') cancel();
        return grant;
      });
      try { await expect(open(impl, site)).rejects.toThrow(); }
      finally { arm.mockRestore(); access.mockRestore(); digest.mockRestore(); }
      await impl.usageLifecycle.drain();
    });
    const state = await inspect(key);
    expect(state.receipts).toHaveLength(0);
    expect(state.runs.every(r => r.finished === 1)).toBe(true);
  }
});

it.each(['agent', 'control'])('original User snapshot, begin and adoption reply suspension at %s retains exact cancellation', async site => {
  for (const phase of ['snapshot', 'begin', 'adopt']) {
    const {key, user, overseer} = await fixture();
    let reached!: () => void;
    const ready = new Promise<void>(resolve => { reached = resolve; });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await runInDurableObject(user, instance => {
      const proto = Object.getPrototypeOf(instance) as UserDurableObject;
      if (phase === 'snapshot') {
        const original = instance.readUsageAcquisitionSlotsV2.bind(instance);
        vi.spyOn(proto, 'readUsageAcquisitionSlotsV2').mockImplementation(async () => {
          const result = await original(); reached(); await gate; return result;
        });
      } else if (phase === 'begin') {
        const original = instance.beginDeploymentUsageAcquisitionV2.bind(instance);
        vi.spyOn(proto, 'beginDeploymentUsageAcquisitionV2').mockImplementation(async ticket => {
          const result = await original(ticket); reached(); await gate; return result;
        });
      } else {
        const original = instance.adoptDeploymentUsageAcquisitionV2.bind(instance);
        vi.spyOn(proto, 'adoptDeploymentUsageAcquisitionV2').mockImplementation(async ticket => {
          const result = await original(ticket); reached(); await gate; return result;
        });
      }
    });
    await runInDurableObject(overseer, async (instance, ctx) => {
      const impl = instance['impl'];
      const pending = open(impl, site).then(async s => { await s[Symbol.asyncDispose](); return false; }, () => true);
      await ready;
      const record = impl.usageLifecycle.journal.records()[0];
      expect(record.state).toBe(phase === 'adopt' ? 'adopting' : 'acquiring');
      if (phase !== 'snapshot') {
        expect(record.remote?.owner).toBe(user.id.toString());
        expect(JSON.parse(record.remote!.ticket)).toMatchObject(record.intent);
      }
      expect(await ctx.storage.getAlarm()).toBeLessThanOrEqual(record.intent.acquireBy);
      impl.usageLifecycle.journal.close(record, Date.now()); release();
      expect(await pending).toBe(true);
    });
    expect((await inspect(key)).runs.every(r => r.finished === 1)).toBe(true);
    vi.restoreAllMocks();
  }
});

it('real Overseer eviction after final activation/root loss closes the retained adopting ticket, never begins replacement', async () => {
  const {key, user, overseer} = await fixture();
  await runInDurableObject(user, instance => {
    const proto = Object.getPrototypeOf(instance) as UserDurableObject;
    const original = instance.adoptDeploymentUsageAcquisitionV2.bind(instance);
    vi.spyOn(proto, 'adoptDeploymentUsageAcquisitionV2').mockImplementation(async ticket => {
      using _dropped = new RpcStub(await original(ticket));
      throw new Error('synthetic lost final reply');
    });
    vi.spyOn(proto, 'cancelDeploymentUsageAcquisitionV2').mockRejectedValue(new Error('synthetic route outage'));
  });
  await runInDurableObject(overseer, async instance => {
    instance['impl'].storage.activeAgents.delete(execution.chat);
    await expect(open(instance['impl'], 'control')).rejects.toThrow();
    expect(instance['impl'].usageLifecycle.journal.records()[0].state).toBe('cleaning');
  });
  await abortAllDurableObjects();
  vi.restoreAllMocks();
  const reopened = env.TEST_OVERSEER.getByName(key);
  await runInDurableObject(reopened, async instance => {
    const impl = instance['impl']; impl.users = env.TEST_USER_V2;
    expect(impl.usageLifecycle.journal.records()[0].state).toBe('cleaning');
    await impl.usageLifecycle.journal.drain(async target => {
      return await env.TEST_USER_V2.get(env.TEST_USER_V2.idFromString(target.owner))
        .cancelDeploymentUsageAcquisitionV2(JSON.parse(target.ticket)) === 'terminal';
    }, impl.usageLifecycle.journal.records()[0].retryAt);
  });
  expect((await inspect(key)).runs).toHaveLength(1);
  expect((await inspect(key)).runs[0].finished).toBe(1);
});

it.each(['agent', 'control'].flatMap(site => ['begin', 'activate', 'final-root'].map(method => ({site, method}))))(
  'native actual $site call interrupted during $method reply retains its original ticket after eviction', async ({site, method}) => {
  const {key, overseer, user} = await fixture(true);
  if (site === 'control') await runInDurableObject(overseer, instance => { instance['impl'].storage.activeAgents.delete(execution.chat); });
  else await runInDurableObject(user, instance => {
    vi.spyOn(Object.getPrototypeOf(instance) as UserDurableObject, 'getChatContext').mockImplementation(() => new Promise(() => {}));
  });
  let finalRootReached = false;
  if (method === 'final-root') {
    await runInDurableObject(user, instance => {
      const original = instance.adoptDeploymentUsageAcquisitionV2.bind(instance);
      vi.spyOn(Object.getPrototypeOf(instance) as UserDurableObject, 'adoptDeploymentUsageAcquisitionV2').mockImplementation(async ticket => {
        const root = await original(ticket); finalRootReached = true; await sleep(1000); return root;
      });
    });
  } else await fault(key, {method, delay: 1000});
  const pending = (async () => {
    try {
      const native = env.TEST_PAIRED_PROBE.getByName(key);
      using root = await (site === 'agent' ? native.acquireAgent() : native.acquireControl());
      await root?.finish();
    }
    catch { /* Native eviction is expected; persisted state is asserted below. */ }
  })();
  // Synchronize on actual SQLite effects rather than assuming admission completed in 100ms.
  const until = Date.now() + 3000;
  while (Date.now() < until) {
    const state = await inspect(key);
    if ((method !== 'final-root' || finalRootReached) &&
        state.slots.some(s => s.state === (method === 'begin' ? 'pending' : 'active'))) break;
    await sleep(10);
  }
  await abortAllDurableObjects(); await pending;
  if (method === 'final-root') expect(finalRootReached).toBe(true);
  const reopened = env.TEST_PAIRED_PROBE.getByName(key);
  await runInDurableObject(reopened, async instance => {
    instance['impl'].users = env.TEST_USER_V2;
    await instance['impl'].usageLifecycle.drain();
    if (site === 'agent') await instance['impl'].cancelAgent(execution.chat);
  });
  const state = await inspect(key);
  expect(state.runs).toHaveLength(1); expect(state.runs[0].finished).toBe(1);
  expect(state.receipts).toHaveLength(0);
});

it('adopted exact agent lease survives native eviction; lookup preserves original expiry past role TTL', async () => {
  const {key, user, overseer} = await fixture();
  // Hold only model resolution on wake. Acquisition and all accounting remain the real paths.
  await runInDurableObject(user, instance => {
    vi.spyOn(Object.getPrototypeOf(instance) as UserDurableObject, 'getChatContext').mockImplementation(() => new Promise(() => {}));
  });
  const grant = await runInDurableObject(overseer, async instance => {
    const impl = instance['impl'];
    const scope = await open(impl, 'agent');
    const current = impl.storage.activeAgents.get(execution.chat)!;
    current.deploymentUsageRun = scope.grant; impl.storage.activeAgents.put(current);
    // Transient scope/root deliberately die with the DO; disposal is not finish.
    scope.run[Symbol.dispose]();
    return scope.grant;
  });
  await abortAllDurableObjects();
  await env.ACCESS_STATE.getByName(key).set({ttl: 1000});
  await sleep(5100); // Original acquisition window is over; this must be lookup, not adoption.
  const reopened = env.TEST_OVERSEER.getByName(key);
  await runInDurableObject(reopened, async instance => {
    const impl = instance['impl']; impl.users = env.TEST_USER_V2;
    await using resumed = (await impl.newUsageScope(grant, execution))!;
    expect(resumed.grant).toEqual(grant);
    await sleep(1100);
    await resumed.reserve({externalRequests: 1});
    expect(await resumed.run.getGrant()).toEqual(grant);
    await impl.cancelAgent(execution.chat);
  });
  expect((await inspect(key)).runs).toHaveLength(1);
});

it('a lost final scope reply cannot begin a replacement for the same execution after cleanup and native eviction', async () => {
  const {key, user, overseer} = await fixture();
  await runInDurableObject(user, instance => {
    vi.spyOn(Object.getPrototypeOf(instance) as UserDurableObject, 'getChatContext').mockImplementation(() => new Promise(() => {}));
  });
  await runInDurableObject(overseer, async instance => {
    const impl = instance['impl'];
    // Real method completes, but its caller loses the scope before persisting the final grant.
    await using lost = (await impl.newUsageScope(undefined, execution))!;
    expect(impl.storage.activeAgents.get(execution.chat)?.deploymentUsageRun).toBeUndefined();
    expect(impl.storage.activeAgents.get(execution.chat)?.deploymentUsageV2Attempted).toBe(true);
    await lost.run.finish();
    expect(impl.usageLifecycle.journal.records()).toHaveLength(0);
    await expect(impl.newUsageScope(undefined, execution)).rejects.toThrow();
  });
  await abortAllDurableObjects();
  await runInDurableObject(env.TEST_OVERSEER.getByName(key), async instance => {
    instance['impl'].users = env.TEST_USER_V2;
    await expect(instance['impl'].newUsageScope(undefined, execution)).rejects.toThrow();
    await instance['impl'].cancelAgent(execution.chat);
  });
  expect((await inspect(key)).runs).toHaveLength(1);
});

it('actual startAgent supplies its creation-owned execution to the paired call site and Stop prevents downstream work', async () => {
  const {key, overseer, user} = await fixture();
  await runInDurableObject(overseer, async instance => {
    const impl = instance['impl'];
    impl.storage.activeAgents.delete(execution.chat);
    const original = impl.newUsageScope.bind(impl);
    let reached!: () => void;
    const done = new Promise<void>(resolve => { reached = resolve; });
    const admission = vi.spyOn(impl, 'newUsageScope').mockImplementation(async (...args) => {
      expect(args[1]?.id).toBe(impl.storage.activeAgents.get(execution.chat)?.executionId);
      const scope = await original(...args);
      await impl.cancelAgent(execution.chat); reached(); return scope;
    });
    const waiter = vi.spyOn(impl.ctx, 'waitUntil').mockImplementation(() => {});
    try {
      impl.startAgent(execution.chat, {profile: {type: 'agent', id: 'fixture', name: 'Fixture'},
        config: {provider: 'openai', model: 'gpt-4.1', apiToken: 'unused'}},
        {type: 'agent', id: 'fixture', name: 'Fixture'}, user.id.toString());
      await done; await sleep(30);
      expect(impl.usageLifecycle.journal.records().every(r => r.state === 'cleaning')).toBe(true);
    } finally { admission.mockRestore(); waiter.mockRestore(); }
  });
  expect((await inspect(key)).runs).toHaveLength(1);
  expect((await inspect(key)).receipts).toHaveLength(0);
});

it('actual getUsageBudget agent branch borrows the actual startAgent scope without finishing its parent', async () => {
  const {key, overseer, user} = await fixture();
  await runInDurableObject(overseer, async instance => {
    const impl = instance['impl']; impl.storage.activeAgents.delete(execution.chat);
    let reached!: () => void;
    const ready = new Promise<void>(resolve => { reached = resolve; });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    // Pause only the next unrelated phase, after actual admission and before any provider.
    const pause = vi.spyOn(impl, 'reconcilePendingGadgets').mockImplementation(async () => {
      reached(); await gate; // Actual creation-owned Stop check runs immediately after this await.
    });
    const waiter = vi.spyOn(impl.ctx, 'waitUntil').mockImplementation(() => {});
    try {
      impl.startAgent(execution.chat, {profile: {type: 'agent', id: 'fixture', name: 'Fixture'},
        config: {provider: 'openai', model: 'gpt-4.1', apiToken: 'unused'}},
        {type: 'agent', id: 'fixture', name: 'Fixture'}, user.id.toString());
      await ready;
      using borrowed = await impl.getUsageBudget({from: 'agent', chatId: execution.chat});
      await borrowed!.finish();
      expect((await borrowed!.getGrant()).runId).toBe(impl.storage.activeAgents.get(execution.chat)?.deploymentUsageRun?.runId);
      await borrowed!.reserve({externalRequests: 1});
      await impl.cancelAgent(execution.chat);
      await refused(async () => await borrowed!.getGrant());
    } finally { release(); await sleep(30); pause.mockRestore(); waiter.mockRestore(); }
  });
  expect((await inspect(key)).runs).toHaveLength(1);
  expect((await inspect(key)).runs[0].finished).toBe(1);
});

it.each(['agent', 'control'])('malformed User V2 responses at %s fail closed, with no transient fallback', async site => {
  for (const phase of ['snapshot', 'pending', 'root']) {
    const {key, user, overseer} = await fixture();
    let legacy = 0;
    await runInDurableObject(user, instance => {
      const proto = Object.getPrototypeOf(instance) as UserDurableObject;
      vi.spyOn(proto, 'beginDeploymentUsageRun').mockImplementation(async () => { legacy++; throw new Error('must not fallback'); });
      if (phase === 'snapshot') {
        const original = instance.readUsageAcquisitionSlotsV2.bind(instance);
        vi.spyOn(proto, 'readUsageAcquisitionSlotsV2').mockImplementation(async () => {
          const result = await original(); result.slots.push(result.slots[0]); return result;
        });
      } else if (phase === 'pending') {
        const original = instance.beginDeploymentUsageAcquisitionV2.bind(instance);
        vi.spyOn(proto, 'beginDeploymentUsageAcquisitionV2').mockImplementation(async ticket => {
          const result = await original(ticket); result.expiresAt += 900000; return result;
        });
      } else {
        const original = instance.adoptDeploymentUsageAcquisitionV2.bind(instance);
        vi.spyOn(proto, 'adoptDeploymentUsageAcquisitionV2').mockImplementation(async ticket => {
          using _dropped = new RpcStub(await original(ticket));
          return undefined!; // Deliberately malformed native result.
        });
      }
    });
    await runInDurableObject(overseer, async instance => { await expect(open(instance['impl'], site)).rejects.toThrow(); });
    expect(legacy).toBe(0);
    expect((await inspect(key)).runs.every(r => r.finished === 1)).toBe(true);
    vi.restoreAllMocks();
  }
});

it.each(['agent', 'control'])('failed alarm persistence at every %s acquisition stage cannot publish a root', async site => {
  for (let failAt = 1; failAt <= 4; failAt++) {
    const {key, overseer} = await fixture();
    await runInDurableObject(overseer, async instance => {
      const impl = instance['impl'];
      const original = impl.usageLifecycle.journal.arm.bind(impl.usageLifecycle.journal);
      let count = 0;
      const arm = vi.spyOn(impl.usageLifecycle.journal, 'arm').mockImplementation(async () => {
        if (++count === failAt) throw new Error('synthetic alarm persistence failure');
        await original();
      });
      try { await expect(open(impl, site)).rejects.toThrow(); }
      finally { arm.mockRestore(); }
      await impl.usageLifecycle.drain();
    });
    expect((await inspect(key)).runs.every(r => r.finished === 1)).toBe(true);
  }
});

it('lost User terminal acknowledgement retains the original ticket, and retry cannot close a reused winner', async () => {
  const {key, overseer, user} = await fixture();
  let loses = true;
  await runInDurableObject(user, instance => {
    const original = instance.cancelDeploymentUsageAcquisitionV2.bind(instance);
    vi.spyOn(Object.getPrototypeOf(instance) as UserDurableObject, 'cancelDeploymentUsageAcquisitionV2').mockImplementation(async ticket => {
      const terminal = await original(ticket);
      if (loses) throw new Error('synthetic terminal acknowledgement lost');
      return terminal;
    });
  });
  await runInDurableObject(overseer, async instance => {
    const impl = instance['impl'];
    await using first = await open(impl, 'control');
    await first.run.finish();
    const old = impl.usageLifecycle.journal.records()[0];
    expect(old.state).toBe('cleaning');
    await using winner = await open(impl, 'control');
    loses = false;
    await impl.usageLifecycle.journal.drain(async target =>
      await user.cancelDeploymentUsageAcquisitionV2(JSON.parse(target.ticket)) === 'terminal', old.retryAt);
    await first.run.finish();
    expect((await winner.run.getGrant()).runId).toBe(winner.grant.runId);
    await winner.reserve({externalRequests: 1});
  });
  const state = await inspect(key);
  expect(state.runs).toHaveLength(2); expect(state.runs.every(r => r.finished === 1)).toBe(true);
  expect(JSON.parse(state.daily[0].usage).capabilityCalls).toBe(2);
});

it.each(['agent', 'control'])('role denial at %s acquisition and retained root dispatch closes without renewal for cleanup', async site => {
  const {key, overseer} = await fixture();
  await runInDurableObject(overseer, async instance => {
    const impl = instance['impl'];
    await using scope = await open(impl, site);
    await env.ACCESS_STATE.getByName(key).set({denied: true});
    await refused(async () => await scope.run.reserve({externalRequests: 1}));
    await expect(open(impl, site)).rejects.toThrow();
    expect(impl.usageLifecycle.journal.records()).toHaveLength(0);
  });
  expect((await inspect(key)).runs).toHaveLength(1);
  expect((await inspect(key)).runs[0].finished).toBe(1);
});

it('pinned legacy optional READ retains transient V1', async () => {
  const {key, overseer} = await fixture();
  await runInDurableObject(overseer, async instance => {
    const impl = instance['impl'];
    const route = impl.env.DEPLOYMENT_USAGE_V2_ROUTE;
    const required = impl.env.DEPLOYMENT_USAGE_REQUIRED;
    try {
      delete impl.env.DEPLOYMENT_USAGE_V2_ROUTE; delete impl.env.DEPLOYMENT_USAGE_REQUIRED;
      await using scope = await open(impl, 'control');
      expect(impl.usageLifecycle.journal.records()).toHaveLength(0);
      expect(scope.grant.allowed).toBe(true);
    } finally { impl.env.DEPLOYMENT_USAGE_V2_ROUTE = route; impl.env.DEPLOYMENT_USAGE_REQUIRED = required; }
  });
  expect((await inspect(key)).runs).toHaveLength(1);
});

it.each(['agent', 'control'])('protected %s site refuses missing V2 and never falls back to V1', async site => {
  const {key, user, overseer} = await fixture();
  await runInDurableObject(user, instance => { instance['env'].DEPLOYMENT_USAGE_V2_ROUTE = 'missing'; });
  await runInDurableObject(overseer, async instance => { await expect(open(instance['impl'], site)).rejects.toThrow(); });
  expect((await inspect(key)).runs).toHaveLength(0);
});
