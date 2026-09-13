import {env, RpcStub as NativeStub} from 'cloudflare:workers';
import {RpcStub} from 'capnweb';
import {runInDurableObject} from 'cloudflare:test';
import {afterEach, expect, it, vi} from 'vitest';
import type {UserDurableObject} from '../../src/user.js';
import {fixture, good, inspect, native} from './fixture.js';
afterEach(() => vi.restoreAllMocks());
const canonical = (key: string, query: string) => env.CANONICAL_INSPECT.fetch(`https://fixture.test/?native&key=${encodeURIComponent(key)}&${query}`);
const fault = (key: string, body: object) => env.CANONICAL_INSPECT.fetch(`https://fixture.test/?key=${encodeURIComponent(key)}`, {method: 'POST', body: JSON.stringify(body)});

it('lost actual committed reply is unknown; consumed token cannot retry, OFF lookup proves receipt without usage', async () => {
  const f = await fixture(); await canonical(f.key, 'fault=lost-confirm');
  using root = new RpcStub(f.root); using session = await root.openNativePost(f.candidate); expect(session).not.toBeNull();
  const h = good(await session!.prepareSelection(f.input)), d = good(await session!.reviewPrepared(h));
  expect(await session!.confirm(d.token)).toEqual({ok: false, reason: 'unknown'});
  expect((await native(f.key)).transactions).toHaveLength(1);
  await expect((async () => await session!.confirm(d.token))()).rejects.toThrow();
  const before = await inspect(f.key); f.config.NATIVE_POST_HUMAN_V2 = 'false';
  const {operation, bindingHash} = d.response.evidence.binding;
  const receipt = good(await session!.lookupPost({operation, bindingHash}));
  expect(receipt.result.receipt.selectedIndices).toEqual([0]);
  expect((await inspect(f.key)).runs).toEqual(before.runs);
  // A new currently authenticated root can recover without the old root/token.
  using freshRoot = new RpcStub((await f.publicRoot.authenticateFromCfAccess())!);
  using recovery = await freshRoot.openNativePost(f.candidate); expect(recovery).not.toBeNull();
  expect(good(await recovery!.lookupPost({operation, bindingHash}))).toEqual(receipt);
  await expect((async () => await recovery!.prepareSelection(f.input))()).rejects.toThrow();
  f.config.NATIVE_POST_HUMAN_V2 = 'true';
  await expect((async () => await recovery!.listCaptures())()).rejects.toThrow(); // OFF receiver never upgrades
  expect((await inspect(f.key)).runs).toEqual(before.runs);
  await recovery!.stop();
  expect(await session!.dismissPrepared(h)).toEqual({status: 'committed'});
});

it('lost actual prepared reply blocks replacement and exact Stop closes the real paid reservation', async () => {
  const f = await fixture(); await canonical(f.key, 'fault=lost-prepare');
  using root = new RpcStub(f.root); using session = await root.openNativePost(f.candidate); expect(session).not.toBeNull();
  expect(await session!.prepareSelection(f.input)).toEqual({ok: false, reason: 'unknown'});
  expect((await native(f.key)).native_capture_reviews).toHaveLength(1);
  await expect((async () => await session!.prepareSelection(f.input))()).rejects.toThrow();
  expect(await session!.stop()).toEqual({status: 'closed'});
  expect((await native(f.key)).native_capture_reviews).toEqual([]);
  expect((await native(f.key)).transactions).toEqual([]);
});

it('actual competing Save causes Post OCC refusal, without consuming selected items', async () => {
  const f = await fixture(); using root = new RpcStub(f.root); using session = await root.openNativePost(f.candidate); expect(session).not.toBeNull();
  const h = good(await session!.prepareSelection(f.input)), d = good(await session!.reviewPrepared(h));
  expect(await (await canonical(f.key, 'save')).json()).toMatchObject({ok: true});
  expect((await session!.confirm(d.token)).ok).toBe(false);
  const sql = await native(f.key); expect(sql.transactions).toHaveLength(1); expect(sql.native_capture_posted_items).toEqual([]);
  await session!.stop(); expect((await inspect(f.key)).runs.every(r => r.finished === 1)).toBe(true);
});

it('expired original W decision is consumed and cannot revive when the clock is restored', async () => {
  const f = await fixture(); using root = new RpcStub(f.root); using session = await root.openNativePost(f.candidate); expect(session).not.toBeNull();
  const h = good(await session!.prepareSelection(f.input)), d = good(await session!.reviewPrepared(h));
  const clock = vi.spyOn(Date, 'now').mockReturnValue(d.response.evidence.deadline);
  await expect((async () => await session!.confirm(d.token))()).rejects.toThrow(); clock.mockRestore();
  await expect((async () => await session!.confirm(d.token))()).rejects.toThrow();
  expect((await native(f.key)).transactions).toEqual([]); await session!.stop();
});

it('separate funded capture Stop uses its real capability leaf and never Posts', async () => {
  const f = await fixture(); using root = new RpcStub(f.root); using session = await root.openNativePost(f.candidate); expect(session).not.toBeNull();
  expect(await session!.stopCapture(f.input.capture)).toEqual({status: 'closed'});
  const sql = await native(f.key); expect(sql.transactions).toEqual([]); expect(sql.native_captures[0].phase).toBe('cancelled');
  const state = await inspect(f.key); expect(state.runs).toHaveLength(1); expect(state.receipts).toHaveLength(1);
  expect(state.runs[0].finished).toBe(1); expect(JSON.parse(state.daily[0].usage).capabilityCalls).toBe(2);
});

it.each(['rootAbort', 'handoffExpiry', 'grantLoss'] as const)('actual acquired root %s refuses dispatch and finishes the real M run', async mode => {
  const f = await fixture(); using root = new RpcStub(f.root); using session = await root.openNativePost(f.candidate); expect(session).not.toBeNull();
  await runInDurableObject(f.overseer, i => {
    const impl = i['impl'], original = impl.getUsageBudget.bind(impl);
    vi.spyOn(impl, 'getUsageBudget').mockImplementation(async caller => {
      const actual = await original(caller);
      if (mode === 'rootAbort') f.abort.abort();
      if (mode === 'handoffExpiry') vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5001);
      if (mode === 'grantLoss') await fault(f.key, {method: 'grant', fail: 'after'});
      return actual;
    });
  });
  expect((await session!.prepareSelection(f.input)).ok).toBe(false);
  expect((await native(f.key)).native_capture_reviews).toEqual([]);
  const state = await inspect(f.key); expect(state.runs).toHaveLength(1); expect(state.runs[0].finished).toBe(1); expect(state.receipts).toEqual([]);
  await session!.stop();
});

it.each(['before', 'after'] as const)('real begin %s loss cannot dispatch or lose original-route cleanup', async fail => {
  const f = await fixture(); using root = new RpcStub(f.root); using session = await root.openNativePost(f.candidate); expect(session).not.toBeNull();
  await fault(f.key, {method: 'begin', fail});
  expect((await session!.prepareSelection(f.input)).ok).toBe(false);
  await fault(f.key, {});
  await runInDurableObject(f.overseer, async i => {
    const journal = i['impl'].usageLifecycle.journal;
    for (const r of journal.records()) await journal.drain(async target =>
      await env.TEST_USER_V2.get(env.TEST_USER_V2.idFromString(target.owner)).cancelDeploymentUsageAcquisitionV2(JSON.parse(target.ticket)) === 'terminal', r.retryAt);
    expect(journal.records()).toEqual([]);
  });
  expect((await inspect(f.key)).runs.every(r => r.finished === 1)).toBe(true);
  expect((await native(f.key)).native_capture_reviews).toEqual([]); await session!.stop();
});

it('lost actual adopt reply retains durable original route during outage and drains with native OFF', async () => {
  const f = await fixture(); using root = new RpcStub(f.root); using session = await root.openNativePost(f.candidate); expect(session).not.toBeNull();
  await runInDurableObject(f.user, u => {
    const proto = Object.getPrototypeOf(u) as UserDurableObject, original = u.adoptDeploymentUsageAcquisitionV2.bind(u);
    vi.spyOn(proto, 'adoptDeploymentUsageAcquisitionV2').mockImplementation(async ticket => {
      using _dropped = new NativeStub(await original(ticket));
      throw Error('Synthetic lost genuine adopted root');
    });
    vi.spyOn(proto, 'cancelDeploymentUsageAcquisitionV2').mockRejectedValue(Error('Synthetic cancellation outage'));
  });
  expect((await session!.prepareSelection(f.input)).ok).toBe(false);
  await runInDurableObject(f.overseer, i => {
    const rows = i['impl'].usageLifecycle.journal.records(); expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe('cleaning'); expect(rows[0].remote?.owner).toBe(f.userId);
  });
  vi.restoreAllMocks(); f.config.NATIVE_POST_HUMAN_V2 = 'false';
  await runInDurableObject(f.overseer, async i => {
    const impl = i['impl']; impl.env.NATIVE_POST_HUMAN_V2 = 'false'; const journal = impl.usageLifecycle.journal;
    await journal.drain(async target => await env.TEST_USER_V2.get(env.TEST_USER_V2.idFromString(target.owner)).cancelDeploymentUsageAcquisitionV2(JSON.parse(target.ticket)) === 'terminal', journal.records()[0].retryAt);
    expect(journal.records()).toEqual([]);
  });
  expect((await inspect(f.key)).runs.every(r => r.finished === 1)).toBe(true);
  expect((await native(f.key)).transactions).toEqual([]); await session!.stop();
});

it('lost real finish reply retains cleaning responsibility and drains the exact original route', async () => {
  const f = await fixture(); using root = new RpcStub(f.root); using session = await root.openNativePost(f.candidate); expect(session).not.toBeNull();
  await runInDurableObject(f.user, u => {
    const proto = Object.getPrototypeOf(u) as UserDurableObject, original = u.cancelDeploymentUsageAcquisitionV2.bind(u);
    vi.spyOn(proto, 'cancelDeploymentUsageAcquisitionV2').mockImplementation(async ticket => {
      const result = await original(ticket);
      if (result === 'terminal') throw Error('Synthetic lost genuine terminal finish ACK');
      return result;
    });
  });
  const h = good(await session!.prepareSelection(f.input));
  const state = await inspect(f.key); expect(state.runs).toHaveLength(1); expect(state.runs[0].finished).toBe(1);
  await runInDurableObject(f.overseer, i => expect(i['impl'].usageLifecycle.journal.records()[0].state).toBe('cleaning'));
  vi.restoreAllMocks();
  await runInDurableObject(f.overseer, async i => {
    const journal = i['impl'].usageLifecycle.journal;
    await journal.drain(async target => await env.TEST_USER_V2.get(env.TEST_USER_V2.idFromString(target.owner)).cancelDeploymentUsageAcquisitionV2(JSON.parse(target.ticket)) === 'terminal', journal.records()[0].retryAt);
    expect(journal.records()).toEqual([]);
  });
  expect(await session!.dismissPrepared(h)).toEqual({status: 'closed'});
});
