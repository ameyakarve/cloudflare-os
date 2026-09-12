import {expect, it} from 'vitest';
import {env} from 'cloudflare:workers';
import {abortAllDurableObjects, runInDurableObject, runDurableObjectAlarm} from 'cloudflare:test';
import type {UserDurableObject} from '../../src/user.js';
import type {AccessState} from './worker.js';
import type {UsageReceiverTicket} from '../../src/usage-acquisition-receiver.js';
import {UsageScope} from '../../src/deployment-usage.js';

declare global {
 namespace Cloudflare {
  interface Env {
    TEST_USER_V2: DurableObjectNamespace<UserDurableObject>;
    ACCESS_STATE: DurableObjectNamespace<AccessState>;
    CANONICAL_INSPECT: Fetcher;
  }
 }
}
async function refused(operation: () => Promise<unknown>) {
  let failed = false;
  try { await operation(); } catch { failed = true; }
  expect(failed).toBe(true);
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function fixture() {
  const key = `Case.${crypto.randomUUID()}@example.test`;
  const user = env.TEST_USER_V2.getByName(key);
  await runInDurableObject(user, instance => { instance['env'].DEPLOYMENT_USAGE_V2_ROUTE = 'DEPLOYMENT_USAGE_V2_ROUTE_fixture'; });
  await user.authenticateFromCfAccess(key.toLowerCase(), true);
  await user.bindDeploymentIdentity({subject: key.toLowerCase(), storageKey: key});
  return {key, user};
}
async function candidate(user: DurableObjectStub<UserDurableObject>, window = 5000): Promise<UsageReceiverTicket> {
  const snapshot = await user.readUsageAcquisitionSlotsV2();
  const issuedAt = Date.now();
  return {protocol: 2, namespace: snapshot.namespace, ...snapshot.slots[0], owner: 'synthetic-overseer',
    incarnation: crypto.randomUUID(), operation: crypto.randomUUID(), payloadHash: 'a'.repeat(64), issuedAt, acquireBy: issuedAt + window};
}
async function inspect(key: string) {
  const response = await env.CANONICAL_INSPECT.fetch(`https://fixture.test/?key=${encodeURIComponent(key)}`);
  return response.json<{runs: {id: string; finished: number; expires_at: number}[]; slots: {state: string; exact_generation: string}[];
    daily: {day: number; usage: string}[]; receipts: unknown[]}>();
}
async function fault(key: string, value: object) {
  await env.CANONICAL_INSPECT.fetch(`https://fixture.test/?key=${encodeURIComponent(key)}`, {method: 'POST', body: JSON.stringify(value)});
}

it('actual native User → actual M policy/SQLite UsageDO: pending, adoption, reservation, durable finish', async () => {
  expect(navigator.userAgent).toBe('Cloudflare-Workers');
  const {key, user} = await fixture();
  const ticket = await candidate(user);
  const pending = await user.beginDeploymentUsageAcquisitionV2(ticket);
  expect(pending.state).toBe('pending');
  await refused(async () => await user.beginDeploymentUsageRun(pending.runId));
  expect((await inspect(key)).slots.filter(s => s.state === 'pending')).toHaveLength(1);
  using root = await user.adoptDeploymentUsageAcquisitionV2(ticket);
  expect(await root.getGrant()).toMatchObject({runId: pending.runId, expiresAt: pending.expiresAt});
  await root.reserve({externalRequests: 1});
  expect((await inspect(key)).receipts).toHaveLength(1);
  await root.finish();
  await refused(async () => await root.reserve({externalRequests: 1}));
  const final = await inspect(key);
  expect(final.slots.every(s => s.state === 'free')).toBe(true);
  expect(final.runs[0].finished).toBe(1);
  expect(final.slots.filter(s => s.exact_generation === '1')).toHaveLength(1);
  expect(JSON.parse(final.daily[0].usage)).toMatchObject({capabilityCalls: 1, externalRequests: 1});
});

it('User persists and arms the original full ticket before M admission and adoption before activation', async () => {
  const {key, user} = await fixture();
  const ticket = await candidate(user);
  const earlierSharedAlarm = Date.now() + 1500;
  await runInDurableObject(user, (_instance, ctx) => ctx.storage.setAlarm(earlierSharedAlarm));
  await fault(key, {method: 'begin', delay: 250});
  const begin = (async () => await user.beginDeploymentUsageAcquisitionV2(ticket))();
  await sleep(80);
  await runInDurableObject(user, async (_instance, ctx) => {
    const record = JSON.parse(ctx.storage.sql.exec<{record: string}>('SELECT record FROM usage_caller_slots_v2 WHERE slot = ?', ticket.slot).one().record);
    expect(record.state).toBe('acquiring');
    expect(record.remote.key).toBe(key);
    expect(record.remote.deployment).toBe('DEPLOYMENT_USAGE_V2_ROUTE_fixture');
    expect(JSON.parse(record.remote.ticket)).toMatchObject({issuedAt: ticket.issuedAt, acquireBy: ticket.acquireBy, operationId: ticket.operation});
    expect(await ctx.storage.getAlarm()).toBe(earlierSharedAlarm);
  });
  expect((await inspect(key)).slots.some(s => s.state === 'pending')).toBe(true);
  const pending = await begin;
  await fault(key, {method: 'activate', delay: 250});
  const adoption = (async () => await user.adoptDeploymentUsageAcquisitionV2(ticket))();
  await sleep(80);
  expect(await user.getDeploymentUsageAcquisitionStatusV2(ticket)).toBe('adopting');
  expect((await inspect(key)).slots.some(s => s.state === 'active')).toBe(true);
  await refused(async () => await user.beginDeploymentUsageRun(pending.runId));
  using root = await adoption;
  await root.finish();
});

it('cancel-before-begin never reaches M and changed/old tickets cannot close the winner', async () => {
  const {key, user} = await fixture();
  const old = await candidate(user);
  expect(await user.cancelDeploymentUsageAcquisitionV2(old)).toBe('terminal');
  await refused(async () => await user.beginDeploymentUsageAcquisitionV2(old));
  expect((await inspect(key)).runs).toHaveLength(0);
  const next = await candidate(user);
  await user.beginDeploymentUsageAcquisitionV2(next);
  await user.cancelDeploymentUsageAcquisitionV2({...next, operation: crypto.randomUUID()});
  await user.cancelDeploymentUsageAcquisitionV2(old);
  expect(await user.getDeploymentUsageAcquisitionStatusV2(next)).toBe('pending');
  await user.cancelDeploymentUsageAcquisitionV2(next);
});

it.each(['begin', 'activate'] as const)('lost %s acknowledgement retains the original ticket and closes exactly its real M run', async method => {
  const {key, user} = await fixture();
  const ticket = await candidate(user);
  if (method === 'activate') await user.beginDeploymentUsageAcquisitionV2(ticket);
  await fault(key, {method, fail: 'after'});
  await refused(async () => await (method === 'begin' ? user.beginDeploymentUsageAcquisitionV2(ticket) : user.adoptDeploymentUsageAcquisitionV2(ticket)));
  expect((await inspect(key)).runs).toHaveLength(1);
  expect((await inspect(key)).slots.every(s => s.state === 'free')).toBe(true);
  expect(await user.getDeploymentUsageAcquisitionStatusV2(ticket)).toBe('terminal');
});

it.each(['snapshot', 'begin', 'activate'] as const)('late %s reply never extends the original acquisition deadline', async method => {
  const {key, user} = await fixture();
  const ticket = await candidate(user, 300);
  if (method === 'activate') await user.beginDeploymentUsageAcquisitionV2(ticket);
  await fault(key, {method, delay: 500});
  await refused(async () => await (method === 'activate' ? user.adoptDeploymentUsageAcquisitionV2(ticket) : user.beginDeploymentUsageAcquisitionV2(ticket)));
  await sleep(550);
  await user.cancelDeploymentUsageAcquisitionV2(ticket);
  expect((await inspect(key)).slots.every(s => s.state === 'free')).toBe(true);
});

it('failed cleanup survives User eviction, uses original route without a role, and retry never begins again', async () => {
  const {key, user} = await fixture();
  const ticket = await candidate(user);
  await user.beginDeploymentUsageAcquisitionV2(ticket);
  using root = await user.adoptDeploymentUsageAcquisitionV2(ticket);
  await fault(key, {method: 'cancel', fail: 'before'});
  await root.finish();
  expect(await user.getDeploymentUsageAcquisitionStatusV2(ticket)).toBe('cleaning');
  await env.ACCESS_STATE.getByName(key).set({denied: true});
  await abortAllDurableObjects();
  const reopened = env.TEST_USER_V2.getByName(key);
  expect(await reopened.getDeploymentUsageAcquisitionStatusV2(ticket)).toBe('cleaning');
  await fault(key, {}); await sleep(1100);
  await runDurableObjectAlarm(reopened);
  expect(await reopened.getDeploymentUsageAcquisitionStatusV2(ticket)).toBe('terminal');
  expect((await inspect(key)).runs).toHaveLength(1);
  expect((await inspect(key)).slots.every(s => s.state === 'free')).toBe(true);
});

it('pending eviction cancels, adopted eviction resumes by lookup with original expiry only', async () => {
  const first = await fixture();
  const ticket = await candidate(first.user);
  await first.user.beginDeploymentUsageAcquisitionV2(ticket);
  await abortAllDurableObjects();
  expect(await env.TEST_USER_V2.getByName(first.key).getDeploymentUsageAcquisitionStatusV2(ticket)).toBe('terminal');
  const second = await fixture();
  const adopted = await candidate(second.user, 400);
  const pending = await second.user.beginDeploymentUsageAcquisitionV2(adopted);
  using _root = await second.user.adoptDeploymentUsageAcquisitionV2(adopted);
  await sleep(450); // Resume is allowed after acquisition closes, without reopening that window.
  await env.ACCESS_STATE.getByName(second.key).set({ttl: 1000});
  await abortAllDurableObjects();
  const reopened = env.TEST_USER_V2.getByName(second.key);
  using resumed = await reopened.resumeDeploymentUsageRunV2(adopted, {allowed: true, runId: pending.runId, expiresAt: pending.expiresAt});
  expect((await resumed.getGrant()).expiresAt).toBe(pending.expiresAt);
  expect((await inspect(second.key)).runs).toHaveLength(1);
  await resumed.finish();
  await refused(async () => await reopened.resumeDeploymentUsageRunV2(adopted, {allowed: true, runId: pending.runId, expiresAt: pending.expiresAt}));
});

it('role denial before adoption or reserve closes without a new slot or role renewal for cleanup', async () => {
  for (const phase of ['adopt', 'reserve']) {
    const {key, user} = await fixture();
    const ticket = await candidate(user);
    await user.beginDeploymentUsageAcquisitionV2(ticket);
    using root = phase === 'reserve' ? await user.adoptDeploymentUsageAcquisitionV2(ticket) : undefined;
    await env.ACCESS_STATE.getByName(key).set({denied: true});
    await refused(async () => await (root ? root.reserve({externalRequests: 1}) : user.adoptDeploymentUsageAcquisitionV2(ticket)));
    expect((await inspect(key)).receipts).toHaveLength(0);
    expect((await inspect(key)).slots.every(s => s.state === 'free')).toBe(true);
  }
});

it.each(['access', 'snapshot'])('cancel or identity incarnation ABA during suspended %s sends no begin', async stage => {
  for (const aba of [false, true]) {
    const {key, user} = await fixture();
    const ticket = await candidate(user);
    if (stage === 'snapshot') await fault(key, {method: 'snapshot', delay: 250});
    else await env.ACCESS_STATE.getByName(key).set({delay: 250});
    const begin = user.beginDeploymentUsageAcquisitionV2(ticket).then(() => false, () => true);
    await sleep(60);
    if (aba) await runInDurableObject(user, (_instance, ctx) => { ctx.storage.kv.put('usage-identity-v2', crypto.randomUUID()); });
    else await user.cancelDeploymentUsageAcquisitionV2(ticket);
    expect(await begin).toBe(true);
    expect((await inspect(key)).runs).toHaveLength(0);
  }
});

it.each(['begin', 'activate', 'grant', 'reserve'] as const)('cancellation during %s reply prevents every late authority/dispatch result', async method => {
  const {key, user} = await fixture();
  const ticket = await candidate(user);
  if (method !== 'begin') await user.beginDeploymentUsageAcquisitionV2(ticket);
  using root = method === 'grant' || method === 'reserve' ? await user.adoptDeploymentUsageAcquisitionV2(ticket) : undefined;
  await fault(key, {method, delay: 250});
  let dispatched = 0;
  const pending = (async () => {
    try {
      if (root) await (method === 'grant' ? root.getGrant() : root.reserve({externalRequests: 1}));
      else if (method === 'begin') await user.beginDeploymentUsageAcquisitionV2(ticket);
      else { using _late = await user.adoptDeploymentUsageAcquisitionV2(ticket); }
      dispatched++;
    } catch { /* Only a current post-await result could dispatch. */ }
  })();
  await sleep(80);
  await user.cancelDeploymentUsageAcquisitionV2(ticket);
  await pending;
  expect(dispatched).toBe(0);
  expect((await inspect(key)).runs[0].finished).toBe(1);
  expect((await inspect(key)).slots.every(s => s.state === 'free')).toBe(true);
});

it('all twenty original cleanup routes fit, deny authority while cleaning, and drain without new admissions', async () => {
  const {key, user} = await fixture();
  await fault(key, {budget: {concurrentRuns: 20, daily: {capabilityCalls: 20}}});
  const tickets: UsageReceiverTicket[] = [];
  for (let i = 0; i < 20; i++) {
    const ticket = await candidate(user);
    await user.beginDeploymentUsageAcquisitionV2(ticket);
    using _root = await user.adoptDeploymentUsageAcquisitionV2(ticket);
    tickets.push(ticket);
  }
  expect((await user.readUsageAcquisitionSlotsV2()).slots).toHaveLength(0);
  await fault(key, {method: 'cancel', fail: 'before'});
  for (const ticket of tickets) await user.cancelDeploymentUsageAcquisitionV2(ticket);
  expect((await user.readUsageAcquisitionSlotsV2()).slots).toHaveLength(0);
  await env.ACCESS_STATE.getByName(key).set({denied: true});
  await fault(key, {});
  await sleep(2100); await runDurableObjectAlarm(user);
  expect((await user.readUsageAcquisitionSlotsV2()).slots).toHaveLength(20);
  const state = await inspect(key);
  expect(state.runs).toHaveLength(20);
  expect(state.runs.every(r => r.finished === 1)).toBe(true);
  expect(JSON.parse(state.daily[0].usage).capabilityCalls).toBe(20);
  expect(state.slots).toHaveLength(20);
  await env.ACCESS_STATE.getByName(key).set({});
  const exhausted = await candidate(user);
  await refused(async () => await user.beginDeploymentUsageAcquisitionV2(exhausted));
  expect((await inspect(key)).runs).toHaveLength(20); // Cleaning did not refund the daily starts.
});

it.each(['snapshot', 'begin', 'activate', 'grant', 'reserve'] as const)('access TTL expiring across %s await denies handoff/dispatch and keeps the fixed expiry', async method => {
  const {key, user} = await fixture();
  const ticket = await candidate(user);
  const rootPhase = method === 'grant' || method === 'reserve';
  if (method === 'activate' || rootPhase) await user.beginDeploymentUsageAcquisitionV2(ticket);
  using root = rootPhase ? await user.adoptDeploymentUsageAcquisitionV2(ticket) : undefined;
  await env.ACCESS_STATE.getByName(key).set({ttl: 40});
  await fault(key, {method, delay: 120});
  await refused(async () => root ? await (method === 'grant' ? root.getGrant() : root.reserve({externalRequests: 1}))
    : await (method === 'activate' ? user.adoptDeploymentUsageAcquisitionV2(ticket) : user.beginDeploymentUsageAcquisitionV2(ticket)));
  const state = await inspect(key);
  expect(state.runs.every(r => r.finished === 1 && r.expires_at === ticket.issuedAt + 180000)).toBe(true);
  expect(state.slots.every(s => s.state === 'free')).toBe(true);
});

it('changing the current deployment pointer cannot redirect original cleanup, even after identity loss', async () => {
  const {key, user} = await fixture();
  const ticket = await candidate(user);
  await user.beginDeploymentUsageAcquisitionV2(ticket);
  using root = await user.adoptDeploymentUsageAcquisitionV2(ticket);
  await runInDurableObject(user, (instance, ctx) => {
    instance['env'].DEPLOYMENT_USAGE_V2_ROUTE = 'DEPLOYMENT_USAGE_V2_ROUTE_new';
    ctx.storage.kv.put('usage-identity-v2', crypto.randomUUID());
  });
  await refused(async () => await root.getGrant());
  expect((await inspect(key)).runs[0].finished).toBe(1);
  expect((await inspect(key)).slots.every(s => s.state === 'free')).toBe(true);
});

it('missing V2 route never calls legacy begin and malformed pending replies are cancelled by original ticket', async () => {
  const first = await fixture();
  await runInDurableObject(first.user, instance => { instance['env'].DEPLOYMENT_USAGE_V2_ROUTE = undefined; });
  const noRoute = await candidate(first.user);
  await refused(async () => await first.user.beginDeploymentUsageAcquisitionV2(noRoute));
  expect((await inspect(first.key)).runs).toHaveLength(0);
  const invalid = await fixture();
  await fault(invalid.key, {method: 'snapshot', corrupt: true});
  const invalidTicket = await candidate(invalid.user);
  await refused(async () => await invalid.user.beginDeploymentUsageAcquisitionV2(invalidTicket));
  expect((await inspect(invalid.key)).runs).toHaveLength(0);
  const second = await fixture();
  const corrupt = await candidate(second.user);
  await fault(second.key, {method: 'begin', corrupt: true});
  await refused(async () => await second.user.beginDeploymentUsageAcquisitionV2(corrupt));
  expect((await inspect(second.key)).runs).toHaveLength(1);
  expect((await inspect(second.key)).runs[0].finished).toBe(1);
});

it('cancel acknowledgement loss, repeated finish, and local alarm persistence failure never erase obligations', async () => {
  const {key, user} = await fixture();
  const ticket = await candidate(user);
  await user.beginDeploymentUsageAcquisitionV2(ticket);
  using root = await user.adoptDeploymentUsageAcquisitionV2(ticket);
  await fault(key, {method: 'cancel', fail: 'after'});
  await root.finish();
  expect(await user.getDeploymentUsageAcquisitionStatusV2(ticket)).toBe('cleaning');
  expect((await inspect(key)).runs[0].finished).toBe(1);
  await fault(key, {}); await sleep(600); await root.finish();
  expect(await user.getDeploymentUsageAcquisitionStatusV2(ticket)).toBe('terminal');
  const next = await candidate(user);
  await refused(async () => await runInDurableObject(user, async (instance, ctx) => {
    // Fail before any remote begin; rollback/output-gate behavior is exercised by native storage.
    const original = ctx.storage.setAlarm.bind(ctx.storage);
    await ctx.storage.deleteAlarm();
    ctx.storage.setAlarm = async () => { throw new Error('Injected User alarm persistence failure'); };
    try { await refused(async () => await instance.beginDeploymentUsageAcquisitionV2(next)); }
    finally { ctx.storage.setAlarm = original; }
  }));
  expect((await inspect(key)).runs).toHaveLength(1);
});

it('short actual M expiry closes adopted authority on User alarm; expiry is never receive-time based', async () => {
  const {key, user} = await fixture();
  await fault(key, {budget: {runDurationMs: 400}});
  const ticket = await candidate(user);
  const pending = await user.beginDeploymentUsageAcquisitionV2(ticket);
  expect(pending.expiresAt).toBe(ticket.issuedAt + 400);
  using root = await user.adoptDeploymentUsageAcquisitionV2(ticket);
  await sleep(450); await runDurableObjectAlarm(user);
  await refused(async () => await root.getGrant());
  expect((await inspect(key)).runs[0].finished).toBe(1);
});

it.each([1, 4])('native V1 + pending V2 share canonical concurrency C=%i', async concurrentRuns => {
  const {key, user} = await fixture();
  await fault(key, {budget: {concurrentRuns}});
  using legacy = await user.beginDeploymentUsageRun();
  expect(legacy).toBeDefined();
  const tickets: UsageReceiverTicket[] = [];
  for (let i = 1; i < concurrentRuns; i++) {
    const ticket = await candidate(user);
    await user.beginDeploymentUsageAcquisitionV2(ticket); tickets.push(ticket);
  }
  const denied = await candidate(user);
  await refused(async () => await user.beginDeploymentUsageAcquisitionV2(denied));
  expect((await inspect(key)).runs).toHaveLength(concurrentRuns);
  await legacy!.finish();
  const next = await candidate(user);
  await user.beginDeploymentUsageAcquisitionV2(next); tickets.push(next);
  for (const ticket of tickets) await user.cancelDeploymentUsageAcquisitionV2(ticket);
  const state = await inspect(key);
  expect(state.runs.every(r => r.finished === 1)).toBe(true);
  expect(JSON.parse(state.daily[0].usage).capabilityCalls).toBe(concurrentRuns + 1);
});

it.each(['begin', 'activate'] as const)('User eviction while %s reply is suspended recovers original cleanup, not handoff', async method => {
  const {key, user} = await fixture();
  const ticket = await candidate(user);
  if (method === 'activate') await user.beginDeploymentUsageAcquisitionV2(ticket);
  await fault(key, {method, delay: 350});
  const pending = (async () => {
    try {
      if (method === 'begin') await user.beginDeploymentUsageAcquisitionV2(ticket);
      else { using root = await user.adoptDeploymentUsageAcquisitionV2(ticket); await root.finish(); }
    } catch { /* Native eviction/late refusal is expected; durable state is asserted below. */ }
  })();
  await sleep(70); await abortAllDurableObjects(); await pending;
  const reopened = env.TEST_USER_V2.getByName(key);
  await reopened.cancelDeploymentUsageAcquisitionV2(ticket);
  expect((await inspect(key)).runs).toHaveLength(1);
  expect((await inspect(key)).runs[0].finished).toBe(1);
  expect(await reopened.getDeploymentUsageAcquisitionStatusV2(ticket)).toBe('terminal');
});

it.each(['activate', 'grant'] as const)('changed %s expiry is never adopted or returned as renewed authority', async method => {
  const {key, user} = await fixture();
  const ticket = await candidate(user);
  const pending = await user.beginDeploymentUsageAcquisitionV2(ticket);
  using root = method === 'grant' ? await user.adoptDeploymentUsageAcquisitionV2(ticket) : undefined;
  await fault(key, {method, corrupt: true});
  await refused(async () => root ? await root.getGrant() : await user.adoptDeploymentUsageAcquisitionV2(ticket));
  const state = await inspect(key);
  expect(state.runs).toHaveLength(1);
  expect(state.runs[0]).toMatchObject({finished: 1, expires_at: pending.expiresAt});
  expect(state.slots.every(s => s.state === 'free')).toBe(true);
});

it('actual borrowed scope cannot close its adopted parent; old settlement stays on its original run after slot reuse', async () => {
  const {key, user} = await fixture();
  const ticket = await candidate(user);
  await user.beginDeploymentUsageAcquisitionV2(ticket);
  using root = await user.adoptDeploymentUsageAcquisitionV2(ticket);
  const scope = await UsageScope.open(root.dup());
  const borrowed = scope.borrow();
  const receipt = await borrowed.reserve({tokens: 100});
  await borrowed.finish();
  expect((await root.getGrant()).allowed).toBe(true);
  await scope[Symbol.asyncDispose]();
  const next = await candidate(user);
  const pending = await user.beginDeploymentUsageAcquisitionV2(next);
  using nextRoot = await user.adoptDeploymentUsageAcquisitionV2(next);
  await env.ACCESS_STATE.getByName(key).set({denied: true});
  await root.settleTokens(receipt, 25); // Accounting only, no role renewal or current-slot routing.
  await root.settleTokens(receipt, 25);
  const state = await inspect(key);
  expect(state.runs.find(r => r.id === pending.runId)?.finished).toBe(0);
  expect(JSON.parse(state.daily[0].usage)).toMatchObject({tokens: 25, capabilityCalls: 2});
  await nextRoot.finish();
});

it('actual UsageScope validation failure durably closes the root, even with lost cancellation acknowledgement', async () => {
  const {key, user} = await fixture();
  const ticket = await candidate(user);
  const pending = await user.beginDeploymentUsageAcquisitionV2(ticket);
  using root = await user.adoptDeploymentUsageAcquisitionV2(ticket);
  await fault(key, {method: 'cancel', fail: 'after'});
  await refused(async () => await UsageScope.open(root.dup(),
    {allowed: true, runId: pending.runId, expiresAt: pending.expiresAt + 1}));
  expect(await user.getDeploymentUsageAcquisitionStatusV2(ticket)).toBe('cleaning');
  await refused(async () => await root.getGrant());
  await fault(key, {}); await sleep(600); await root.finish();
  expect(await user.getDeploymentUsageAcquisitionStatusV2(ticket)).toBe('terminal');
  expect((await inspect(key)).runs[0].finished).toBe(1);
});

it('nonterminal cleanup reply retains ownership even when M already closed; exact retry releases it', async () => {
  const {key, user} = await fixture();
  const ticket = await candidate(user);
  await user.beginDeploymentUsageAcquisitionV2(ticket);
  await fault(key, {method: 'cancel', corrupt: true});
  await user.cancelDeploymentUsageAcquisitionV2(ticket);
  expect(await user.getDeploymentUsageAcquisitionStatusV2(ticket)).toBe('cleaning');
  expect((await inspect(key)).runs[0].finished).toBe(1);
  await fault(key, {}); await sleep(600);
  await user.cancelDeploymentUsageAcquisitionV2(ticket);
  expect(await user.getDeploymentUsageAcquisitionStatusV2(ticket)).toBe('terminal');
  expect(JSON.parse((await inspect(key)).daily[0].usage).capabilityCalls).toBe(1);
});

it.each(['owner', 'incarnation', 'operation', 'payloadHash', 'issuedAt', 'acquireBy'] as const)(
  'changed upstream %s cannot adopt, cancel, or overwrite a pending winner', async field => {
    const {key, user} = await fixture();
    const ticket = await candidate(user, 4000);
    const pending = await user.beginDeploymentUsageAcquisitionV2(ticket);
    const changed = {...ticket};
    if (field === 'issuedAt' || field === 'acquireBy') changed[field]++;
    else changed[field] = field === 'payloadHash' ? 'b'.repeat(64) : crypto.randomUUID();
    await refused(async () => await user.beginDeploymentUsageAcquisitionV2(changed));
    await refused(async () => await user.adoptDeploymentUsageAcquisitionV2(changed));
    await user.cancelDeploymentUsageAcquisitionV2(changed);
    expect(await user.getDeploymentUsageAcquisitionStatusV2(ticket)).toBe('pending');
    using root = await user.adoptDeploymentUsageAcquisitionV2(ticket);
    expect((await root.getGrant()).expiresAt).toBe(pending.expiresAt);
    await root.finish();
    expect((await inspect(key)).runs).toHaveLength(1);
  });

it('equivalent identity rebind and healthy role renewal preserve adoption; mismatched resume closes without allocating', async () => {
  const {key, user} = await fixture();
  const ticket = await candidate(user);
  const pending = await user.beginDeploymentUsageAcquisitionV2(ticket);
  using root = await user.adoptDeploymentUsageAcquisitionV2(ticket);
  // Deliberately reverse property order: serialization order is not an identity change.
  await user.bindDeploymentIdentity({storageKey: key, subject: key.toLowerCase()});
  await env.ACCESS_STATE.getByName(key).set({ttl: 1000});
  expect((await root.getGrant()).expiresAt).toBe(pending.expiresAt);
  await refused(async () => await user.resumeDeploymentUsageRunV2(ticket,
    {allowed: true, runId: pending.runId, expiresAt: pending.expiresAt + 1}));
  await refused(async () => await root.reserve({externalRequests: 1}));
  const state = await inspect(key);
  expect(state.runs).toHaveLength(1);
  expect(state.runs[0].finished).toBe(1);
  expect(state.receipts).toHaveLength(0);
});

it('unavailable original binding and transport timeout retain the same bounded obligation', async () => {
  const {key, user} = await fixture();
  const ticket = await candidate(user);
  await user.beginDeploymentUsageAcquisitionV2(ticket);
  using root = await user.adoptDeploymentUsageAcquisitionV2(ticket);
  await fault(key, {method: 'cancel', delay: 1500});
  await runInDurableObject(user, async instance => {
    const original = instance['env'].DEPLOYMENT_USAGE_V2_ROUTE_fixture;
    instance['env'].DEPLOYMENT_USAGE_V2_ROUTE_fixture = undefined;
    try {
      await instance.cancelDeploymentUsageAcquisitionV2(ticket);
      expect(await instance.getDeploymentUsageAcquisitionStatusV2(ticket)).toBe('cleaning');
      expect((await inspect(key)).runs[0].finished).toBe(0);
    } finally { instance['env'].DEPLOYMENT_USAGE_V2_ROUTE_fixture = original; }
  });
  await sleep(600);
  await root.finish();
  expect(await user.getDeploymentUsageAcquisitionStatusV2(ticket)).toBe('cleaning');
  expect((await inspect(key)).runs[0].finished).toBe(1);
  await fault(key, {}); await sleep(1100); await root.finish();
  expect(await user.getDeploymentUsageAcquisitionStatusV2(ticket)).toBe('terminal');
  expect((await inspect(key)).runs).toHaveLength(1);
});
