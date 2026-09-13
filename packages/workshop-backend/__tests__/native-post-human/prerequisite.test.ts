import {env, RpcStub} from 'cloudflare:workers';
import {RpcStub as BrowserStub} from 'capnweb';
import {createExecutionContext, runInDurableObject, abortAllDurableObjects} from 'cloudflare:test';
import {afterEach, expect, it, vi} from 'vitest';
import {PublicApiImpl, type NativePostContextRoot} from '../../src/server.js';
import type {AuthenticatedApi} from '@gadgets/workshop-shared/api';
import {INSTALL_QUARANTINE_KEY} from '../../src/deployment-install-quarantine.js';
import {acquireNativePostContext} from '../../src/native-post-human.js';
import type {OverseerDurableObject} from '../../src/overseer.js';
import type {UserDurableObject} from '../../src/user.js';
import type {AccessState} from '../user-usage-v2/worker.js';

declare global { namespace Cloudflare { interface Env {
  TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>;
  TEST_USER_V2: DurableObjectNamespace<UserDurableObject>;
  ACCESS_STATE: DurableObjectNamespace<AccessState>;
  CANONICAL_INSPECT: Fetcher;
} } }
afterEach(() => vi.restoreAllMocks());
async function inspect(key: string) {
  return (await env.CANONICAL_INSPECT.fetch(`https://fixture.test/?key=${encodeURIComponent(key)}`)).json<{
    runs: {id: string; finished: number}[]; receipts: unknown[]; daily: {usage: string}[];
  }>();
}
async function fixture() {
  const key = `Native.${crypto.randomUUID()}@example.test`;
  const overseer = env.TEST_OVERSEER.getByName(key);
  const result = await runInDurableObject(overseer, async (instance, ctx) => {
    const abort = new AbortController();
    const context = Object.assign(createExecutionContext(), {exports: {
      ...ctx.exports, UserDurableObject: env.TEST_USER_V2, OverseerDurableObject: env.TEST_OVERSEER,
    }, waitUntil: (promise: Promise<unknown>) => ctx.waitUntil(promise)});
    const config = {...instance['env'], MILESVAULT_AUTH: 'true', NATIVE_POST_HUMAN_V2: 'true'};
    const publicRoot = new PublicApiImpl(context, config, reason => abort.abort(reason),
      {email: key.toLowerCase(), externalIdentityKey: key}, abort.signal);
    const root = await publicRoot.authenticateFromCfAccess() as AuthenticatedApi & NativePostContextRoot;
    const user = env.TEST_USER_V2.get(env.TEST_USER_V2.idFromString(await root.getRecoveryPrincipal()));
    await user.newGadget(overseer.id.toString(), 'Synthetic registered workspace');
    const impl = instance['impl'];
    impl.users = env.TEST_USER_V2;
    impl.ownerId = user.id.toString(); impl.storage.ownerId.put(impl.ownerId);
    impl.env.NATIVE_POST_HUMAN_V2 = 'true';
    // Synthetic initial metadata only. Actual canonical binding factory, User ownership and queue.
    impl.storage.gadgets.put({type: 'gadget', id: 3, title: 'Not an authority selector', created: new Date(0),
      bindingName: 'LEDGER', bindings: {}, output: {id: 'ledger', noun: 'Ledger', plural: 'Ledgers', icon: 'table'}});
    await instance.configureMilesVaultLedgerOutput(user.id.toString(), key);
    const candidate = {workspaceId: overseer.id.toString(), workpieceId: '3'};
    return {key, root, publicRoot, userId: user.id.toString(), overseer, abort, config, candidate};
  });
  return {...result, user: env.TEST_USER_V2.get(env.TEST_USER_V2.idFromString(result.userId))};
}

it('actual authenticated root remains denied; native prerequisite is not a browser/anonymous RPC member', async () => {
  const f = await fixture();
  using root = new BrowserStub(f.root);
  expect(await root.openNativePost(f.candidate)).toBeNull();
  expect(await root.openNativePost(f.candidate, {enabled: true, owner: f.key})).toBeNull();
  using anonymous = new BrowserStub(f.publicRoot);
  await expect((async () => await Reflect.get(anonymous, 'openNativePost')(f.candidate))()).rejects.toThrow();
  for (const name of ['acquireNativePostContext', 'getUsageBudget', 'checkNativePost', 'openNativePostOwnerQueue']) {
    await expect((async () => await Reflect.get(root, name)(f.candidate))()).rejects.toThrow();
  }
  using guard = new RpcStub(await f.root[acquireNativePostContext](f.candidate));
  await guard.checkActive();
  await expect((async () => await Reflect.get(guard, 'checkNativePost')({approved: true}))()).rejects.toThrow();
  await expect((async () => await Reflect.apply(guard.getUsageBudget, guard, [{enabled: true}]))()).rejects.toThrow();
  expect((await inspect(f.key)).runs).toHaveLength(0);
});

it.each([undefined, 'false', 'TRUE', '1', 'true ', true, 1])('exact default-OFF control refuses %s', async value => {
  const f = await fixture();
  Object.assign(f.config, {NATIVE_POST_HUMAN_V2: value});
  await expect(f.root[acquireNativePostContext](f.candidate)).rejects.toThrow();
  expect(await f.root.openNativePost(f.candidate)).toBeNull();
  expect((await inspect(f.key)).runs).toHaveLength(0);
});

it('native root → actual owner queue → actual paired User/M preserves all native methods and reconciles one real leaf', async () => {
  const f = await fixture();
  using guard = new RpcStub(await f.root[acquireNativePostContext](f.candidate));
  using run = await guard.getUsageBudget();
  const grant = await run.getGrant();
  expect(grant.allowed).toBe(true);
  const receipt = await run.reserve({capabilityCalls: 1});
  expect(typeof receipt).toBe('string');
  // No model/provider/token leaf in this prerequisite. Native settlement method remains present;
  // unknown receipt must refuse rather than silently accept accounting.
  await expect((async () => await run.settleTokens('foreign', 0))()).rejects.toThrow();
  await run.finish();
  const state = await inspect(f.key);
  expect(state.runs).toHaveLength(1); expect(state.runs[0].finished).toBe(1);
  expect(state.receipts).toHaveLength(1);
  expect(JSON.parse(state.daily[0].usage).capabilityCalls).toBe(2); // admission + actual test leaf
  await runInDurableObject(f.overseer, instance => expect(instance['impl'].usageLifecycle.journal.records()).toHaveLength(0));
});

it.each(['stop', 'ownerABA', 'bindingABA', 'codeABA', 'quarantine', 'resource', 'off'])('retained real owner context refuses %s', async mode => {
  const f = await fixture();
  using guard = new RpcStub(await f.root[acquireNativePostContext](f.candidate));
  await runInDurableObject(f.overseer, async (instance, ctx) => {
    const impl = instance['impl'];
    if (mode === 'stop') await impl.cancelAgent(999).catch(() => {});
    if (mode === 'ownerABA') { const owner = impl.ownerId; impl.ownerId = 'replacement'; impl.ownerId = owner; }
    if (mode === 'bindingABA') {
      await instance.configureMilesVaultLedgerOutput(f.user.id.toString(), 'replacement@example.test');
      await instance.configureMilesVaultLedgerOutput(f.user.id.toString(), f.key);
    }
    if (mode === 'codeABA') { impl.bumpVersion([3]); impl.bumpVersion([3]); }
    if (mode === 'quarantine') ctx.storage.kv.put(INSTALL_QUARANTINE_KEY, {state: 'quarantined'});
    if (mode === 'resource') impl.storage.gatekeepers.delete(impl.getGadgetRecord(3).bindings.LEDGER.target);
    if (mode === 'off') impl.env.NATIVE_POST_HUMAN_V2 = 'false';
  });
  await expect((async () => await guard.checkActive())()).rejects.toThrow();
  await expect((async () => await guard.getUsageBudget())()).rejects.toThrow();
  expect((await inspect(f.key)).runs).toHaveLength(0);
});

it.each(['abort', 'dispose', 'identityABA', 'reset', 'unregister'])('actual root/User %s invalidates a retained context', async mode => {
  const f = await fixture();
  using guard = new RpcStub(await f.root[acquireNativePostContext](f.candidate));
  if (mode === 'abort') f.abort.abort();
  else if (mode === 'dispose') f.root[Symbol.dispose]();
  else await runInDurableObject(f.user, async (user, ctx) => {
    const identity = user['storage'].deploymentIdentity.get()!;
    if (mode === 'reset') {
      await ctx.storage.deleteAll();
      await user.authenticateFromCfAccess(identity.subject, true);
      await user.bindDeploymentIdentity(identity);
      await user.newGadget(f.candidate.workspaceId, 'Replacement registration');
    } else if (mode === 'identityABA') {
      user['storage'].deploymentIdentity.put(null);
      await user.bindDeploymentIdentity(identity);
    } else user['storage'].gadgets.delete(f.candidate.workspaceId);
  });
  await expect((async () => await guard.checkActive())()).rejects.toThrow();
  expect((await inspect(f.key)).runs).toHaveLength(0);
});

it.each(['rootAbort', 'ownerStop', 'grantLoss', 'handoffExpiry'])('failed post-acquisition %s finishes the acquired real root, not just its stub', async mode => {
  const f = await fixture();
  using guard = new RpcStub(await f.root[acquireNativePostContext](f.candidate));
  await runInDurableObject(f.overseer, instance => {
    const impl = instance['impl']; const original = impl.getUsageBudget.bind(impl);
    vi.spyOn(impl, 'getUsageBudget').mockImplementation(async caller => {
      const actual = await original(caller);
      if (mode === 'rootAbort') f.abort.abort();
      if (mode === 'handoffExpiry') {
        const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 5001);
      }
      if (mode === 'ownerStop') await impl.cancelAgent(999).catch(() => {});
      if (mode === 'grantLoss') await env.CANONICAL_INSPECT.fetch(`https://fixture.test/?key=${encodeURIComponent(f.key)}`,
        {method: 'POST', body: JSON.stringify({method: 'grant', fail: 'after'})});
      return actual;
    });
  });
  await expect((async () => await guard.getUsageBudget())()).rejects.toThrow();
  const state = await inspect(f.key);
  expect(state.runs).toHaveLength(1); expect(state.runs[0].finished).toBe(1);
  expect(state.receipts).toHaveLength(0);
});

it.each(['foreignOwner', 'sharedRegistration', 'unregistered', 'readOutput', 'missingPaired'])('factory refuses actual %s context without spending', async mode => {
  const f = await fixture();
  if (mode === 'sharedRegistration' || mode === 'unregistered') {
    await runInDurableObject(f.user, user => {
      const record = user['storage'].gadgets.get(f.candidate.workspaceId)!;
      if (mode === 'unregistered') user['storage'].gadgets.delete(record.id);
      else user['storage'].gadgets.put({...record, owner: {id: 'other', name: 'Other', type: 'user'}});
    });
  } else await runInDurableObject(f.overseer, instance => {
    const impl = instance['impl'];
    if (mode === 'foreignOwner') impl.ownerId = env.TEST_USER_V2.idFromName('other').toString();
    if (mode === 'missingPaired') delete impl.env.DEPLOYMENT_USAGE_V2_ROUTE;
    if (mode === 'readOutput') {
      const gadget = impl.getGadgetRecord(3); delete gadget.systemOutput; impl.storage.gadgets.put(gadget);
    }
  });
  await expect(f.root[acquireNativePostContext](f.candidate)).rejects.toThrow();
  expect(await f.root.openNativePost(f.candidate)).toBeNull();
  expect((await inspect(f.key)).runs).toHaveLength(0);
  if (mode === 'missingPaired') await runInDurableObject(f.overseer, instance => {
    instance['impl'].env.DEPLOYMENT_USAGE_V2_ROUTE = f.config.DEPLOYMENT_USAGE_V2_ROUTE;
  });
});

it('User incarnation is compared after the actual policy await, not just before it', async () => {
  const f = await fixture();
  using guard = new RpcStub(await f.root[acquireNativePostContext](f.candidate));
  await runInDurableObject(f.user, user => {
    const original = user.getDeploymentAccessGrant.bind(user);
    vi.spyOn(Object.getPrototypeOf(user) as UserDurableObject, 'getDeploymentAccessGrant').mockImplementation(async () => {
      const result = await original();
      const identity = user['storage'].deploymentIdentity.get()!;
      user['storage'].deploymentIdentity.put(null); await user.bindDeploymentIdentity(identity);
      return result; // genuine affirmative, but User still must reject its changed incarnation
    });
  });
  await expect((async () => await guard.checkActive())()).rejects.toThrow();
  expect((await inspect(f.key)).runs).toHaveLength(0);
});

it('documents the distributed limit: identity change after genuine final User check is not synchronously locked', async () => {
  const f = await fixture();
  using guard = new RpcStub(await f.root[acquireNativePostContext](f.candidate));
  let reached = false;
  await runInDurableObject(f.user, user => {
    const original = user.checkNativePostIdentity.bind(user);
    vi.spyOn(Object.getPrototypeOf(user) as UserDurableObject, 'checkNativePostIdentity').mockImplementation(async (...args) => {
      const result = await original(...args); reached = true;
      const identity = user['storage'].deploymentIdentity.get()!;
      user['storage'].deploymentIdentity.put(null); await user.bindDeploymentIdentity(identity);
      return result;
    });
  });
  await guard.checkActive(); expect(reached).toBe(true);
  await expect((async () => await guard.checkActive())()).rejects.toThrow();
  expect(await f.root.openNativePost(f.candidate)).toBeNull(); // no M authority attached, ever
  expect((await inspect(f.key)).runs).toHaveLength(0);
});

it('lost original User root reply retains durable cleanup and drains the original route after eviction', async () => {
  const f = await fixture();
  using guard = new RpcStub(await f.root[acquireNativePostContext](f.candidate));
  await runInDurableObject(f.user, user => {
    const proto = Object.getPrototypeOf(user) as UserDurableObject;
    const original = user.adoptDeploymentUsageAcquisitionV2.bind(user);
    vi.spyOn(proto, 'adoptDeploymentUsageAcquisitionV2').mockImplementation(async ticket => {
      using _dropped = new RpcStub(await original(ticket));
      expect((await inspect(f.key)).runs).toHaveLength(1);
      throw new Error('Synthetic lost genuine root reply');
    });
    vi.spyOn(proto, 'cancelDeploymentUsageAcquisitionV2').mockRejectedValue(new Error('Synthetic route outage'));
  });
  await expect((async () => await guard.getUsageBudget())()).rejects.toThrow();
  await runInDurableObject(f.overseer, instance => {
    const rows = instance['impl'].usageLifecycle.journal.records();
    expect(rows).toHaveLength(1); expect(rows[0].state).toBe('cleaning');
    expect(rows[0].remote?.owner).toBe(f.user.id.toString());
  });
  guard[Symbol.dispose]();
  await abortAllDurableObjects(); vi.restoreAllMocks();
  await runInDurableObject(env.TEST_OVERSEER.getByName(f.key), async instance => {
    const impl = instance['impl']; impl.users = env.TEST_USER_V2;
    const original = impl.usageLifecycle.journal.records()[0];
    await impl.usageLifecycle.journal.drain(async target =>
      await env.TEST_USER_V2.get(env.TEST_USER_V2.idFromString(target.owner))
        .cancelDeploymentUsageAcquisitionV2(JSON.parse(target.ticket)) === 'terminal', original.retryAt);
    expect(impl.usageLifecycle.journal.records()).toHaveLength(0);
  });
  const state = await inspect(f.key);
  expect(state.runs).toHaveLength(1); expect(state.runs[0].finished).toBe(1);
  expect(state.receipts).toHaveLength(0);
});
