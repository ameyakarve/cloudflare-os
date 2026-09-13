import {RpcStub} from 'capnweb';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {afterEach, expect, it, vi} from 'vitest';
import {NativePostAuthorityBroker} from '../../../../../packages/custom-gatekeeper/src/native-post-authority.js';
import {NativePostControlsV2} from '../../../../../packages/custom-gatekeeper/src/native-post-controls-v2.js';
import type {NativeHumanGuardV1} from '@gadgets/workshop-shared/os-native-post.generated';
import {fixture, good, inspect, native} from './fixture.js';
afterEach(() => vi.restoreAllMocks());

it('foreign W token consumes the actual decision, without buying a Confirm run', async () => {
  const f = await fixture(); using root = new RpcStub(f.root); using session = await root.openNativePost(f.candidate); expect(session).not.toBeNull();
  const h = good(await session!.prepareSelection(f.input)), d = good(await session!.reviewPrepared(h));
  await expect((async () => await session!.confirm('foreign'))()).rejects.toThrow();
  await expect((async () => await session!.confirm(d.token))()).rejects.toThrow();
  expect((await inspect(f.key)).runs).toHaveLength(2);
  expect((await native(f.key)).transactions).toEqual([]); await session!.stop();
});

it.each(['before-final', 'after-final'] as const)('real purpose-specific final authority: User ABA %s reply', async boundary => {
  const f = await fixture(); using root = new RpcStub(f.root); using session = await root.openNativePost(f.candidate); expect(session).not.toBeNull();
  const h = good(await session!.prepareSelection(f.input)), d = good(await session!.reviewPrepared(h));
  let issued = false, affirmative = false, changed = false;
  const change = () => runInDurableObject(env.TEST_USER_V2.get(env.TEST_USER_V2.idFromString(f.userId)), async u => {
    const identity = u['storage'].deploymentIdentity.get()!;
    u['storage'].deploymentIdentity.put(null); await u.bindDeploymentIdentity(identity); changed = true;
  });
  const issue = NativePostAuthorityBroker.prototype.issueNativePost;
  vi.spyOn(NativePostAuthorityBroker.prototype, 'issueNativePost').mockImplementation(async function(this: NativePostAuthorityBroker, ...args) {
    const authority = await issue.apply(this, args); issued = true;
    if (boundary === 'before-final') await change();
    else {
      const proto = Object.getPrototypeOf(authority) as NativeHumanGuardV1, check = proto.checkNativePost;
      vi.spyOn(proto, 'checkNativePost').mockImplementation(async function(this: NativeHumanGuardV1, evidence) {
        const actual = await check.call(this, evidence);
        if (actual.allowed) { affirmative = true; await change(); }
        return actual; // genuine affirmative computed before remote identity changed
      });
    }
    return authority;
  });
  const result = await session!.confirm(d.token);
  expect(issued).toBe(true); expect(changed).toBe(true);
  if (boundary === 'before-final') {
    expect(result.ok).toBe(false); expect((await native(f.key)).transactions).toEqual([]);
  } else {
    // Remote affirmative is not a distributed identity lock. M can win commit;
    // W suppresses the stale result because its post-dispatch current check fails.
    expect(affirmative).toBe(true); expect(result).toEqual({ok: false, reason: 'unknown'});
    expect((await native(f.key)).transactions).toHaveLength(1);
  }
  await expect((async () => await session!.confirm(d.token))()).rejects.toThrow();
  await session!.stop(); expect((await inspect(f.key)).runs.every(r => r.finished === 1)).toBe(true);
});

it('actual in-flight Stop revokes the issued decision without finishing live paired work early', async () => {
  const f = await fixture(); using root = new RpcStub(f.root); using session = await root.openNativePost(f.candidate); expect(session).not.toBeNull();
  const h = good(await session!.prepareSelection(f.input)), d = good(await session!.reviewPrepared(h));
  const gate = env.TEST_NATIVE_BARRIER.getByName(f.key);
  const issue = NativePostAuthorityBroker.prototype.issueNativePost;
  vi.spyOn(NativePostAuthorityBroker.prototype, 'issueNativePost').mockImplementation(async function(this: NativePostAuthorityBroker, ...args) {
    const authority = await issue.apply(this, args);
    await env.TEST_NATIVE_BARRIER.getByName(f.key).hold();
    return authority;
  });
  const stop = NativePostControlsV2.prototype.stop;
  vi.spyOn(NativePostControlsV2.prototype, 'stop').mockImplementation(async function(this: NativePostControlsV2, ...args) {
    const closing = stop.apply(this, args);
    await env.TEST_NATIVE_BARRIER.getByName(f.key).markRevoked();
    return closing;
  });
  const confirming = (async () => await session!.confirm(d.token))();
  await gate.entered();
  const stopping = (async () => await session!.stop())();
  await gate.revoked();
  const live = await inspect(f.key);
  expect(live.runs).toHaveLength(3); expect(live.runs.filter(r => !r.finished)).toHaveLength(1);
  expect(live.receipts).toHaveLength(3); // the actual Confirm leaf is already reserved
  await gate.release();
  expect((await confirming).ok).toBe(false); expect(await stopping).toEqual({status: 'closed'});
  expect((await native(f.key)).transactions).toEqual([]);
  expect((await inspect(f.key)).runs.every(r => r.finished === 1)).toBe(true);
});

it.each([undefined, '', 'false', 'TRUE', '1', 'true '] as const)('exact OFF %s admits no new root spending even after gate restoration', async value => {
  const f = await fixture(); Object.assign(f.config, {NATIVE_POST_HUMAN_V2: value});
  using root = new RpcStub(f.root); using recovery = await root.openNativePost(f.candidate); expect(recovery).not.toBeNull();
  f.config.NATIVE_POST_HUMAN_V2 = 'true';
  await expect((async () => await recovery!.prepareSelection(f.input))()).rejects.toThrow();
  expect((await inspect(f.key)).runs).toEqual([]); expect((await native(f.key)).native_capture_reviews).toEqual([]);
  expect(await root.openNativePost(f.candidate)).toBeNull(); // one attempt per root
  await recovery!.stop();
});
