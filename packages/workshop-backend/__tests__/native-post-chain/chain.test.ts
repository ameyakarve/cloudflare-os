import {RpcStub} from 'capnweb';
import {runInDurableObject} from 'cloudflare:test';
import {afterEach, expect, it, vi} from 'vitest';
import {fixture, good, inspect, native} from './fixture.js';
import {INSTALL_QUARANTINE_KEY} from '../../src/deployment-install-quarantine.js';
afterEach(() => vi.restoreAllMocks());

it('actual native root → User/Overseer → W application/broker → M Worker/Ledger/Usage SQLite', async () => {
  const f = await fixture();
  using root = new RpcStub(f.root);
  using session = await root.openNativePost(f.candidate);
  expect(session).not.toBeNull();
  const list = good(await session!.listCaptures()); expect(list.rows.map(r => r.id)).toContain(f.input.capture.id);
  expect(good(await session!.getCapture(f.input.capture.id)).postedIndices).toEqual([]);
  const before = await native(f.key);
  const h = good(await session!.prepareSelection(f.input));
  const prepared = await native(f.key);
  expect(prepared.transactions).toHaveLength(0);
  expect(prepared.native_capture_operations).toHaveLength(before.native_capture_operations.length + 1);
  const d = good(await session!.reviewPrepared(h));
  expect(d.response.evidence.userId).toBe(f.userId);
  expect(d.response.evidence.workspaceId).toBe(f.candidate.workspaceId);
  expect(d.response.evidence.workpieceId).toBe('3');
  expect(d.response.evidence.principal).toBe(f.key);
  const receipt = good(await session!.confirm(d.token));
  expect(receipt.result.receipt.selectedIndices).toEqual([0]);
  const posted = await native(f.key);
  expect(posted.transactions).toHaveLength(1);
  expect(posted.native_capture_operations).toHaveLength(prepared.native_capture_operations.length);
  expect(posted.native_capture_reviews).toEqual([]);
  expect(posted.native_capture_sources).toEqual(before.native_capture_sources);
  expect(posted.native_capture_drafts).toEqual(before.native_capture_drafts);
  await expect((async () => await session!.confirm(d.token))()).rejects.toThrow();
  const {operation, bindingHash} = d.response.evidence.binding;
  expect(good(await session!.lookupPost({operation, bindingHash}))).toEqual(receipt);
  expect(await session!.dismissPrepared(h)).toEqual({status: 'committed'});
  await session!.stop();
  const state = await inspect(f.key);
  expect(state.runs).toHaveLength(5); // list/detail/prepare/review/confirm
  expect(state.runs.every(r => r.finished === 1)).toBe(true);
  expect(state.receipts).toHaveLength(5);
  expect(new Set(state.receipts.map(r => r.id)).size).toBe(5);
  expect(new Set(state.receipts.map(r => r.run_id))).toEqual(new Set(state.runs.map(r => r.id)));
  expect(state.receipts.map(r => JSON.parse(r.usage))).toEqual(Array.from({length: 5}, () => ({capabilityCalls: 1, externalRequests: 0, modelRequests: 0, pendingWrites: 0, scheduledStarts: 0, tokens: 0})));
  expect(JSON.parse(state.daily[0].usage).capabilityCalls).toBe(10); // admissions + real leaves
  await runInDurableObject(f.overseer, i => expect(i['impl'].usageLifecycle.journal.records()).toEqual([]));
});

it.each(['cancelReview', 'dismissPrepared', 'stop'] as const)('actual %s closes paid M reservation without new usage admission', async method => {
  const f = await fixture(); using root = new RpcStub(f.root); using session = await root.openNativePost(f.candidate);
  expect(session).not.toBeNull();
  const h = good(await session!.prepareSelection(f.input)), d = good(await session!.reviewPrepared(h));
  const before = await inspect(f.key);
  expect(await (method === 'stop' ? session!.stop() : session![method](h))).toEqual({status: 'closed'});
  await expect((async () => await session!.confirm(d.token))()).rejects.toThrow();
  const sql = await native(f.key);
  expect(sql.transactions).toEqual([]); expect(sql.native_capture_reviews).toEqual([]);
  expect((await inspect(f.key)).runs).toEqual(before.runs);
});

it.each(['identityABA', 'ownerABA', 'bindingABA', 'abort', 'off', 'renderer', 'quarantine', 'resource', 'ownerStop'] as const)('actual retained chain refuses %s before final Post and drains', async mode => {
  const f = await fixture(); using root = new RpcStub(f.root); using session = await root.openNativePost(f.candidate);
  expect(session).not.toBeNull();
  const h = good(await session!.prepareSelection(f.input)), d = good(await session!.reviewPrepared(h));
  if (mode === 'identityABA') await runInDurableObject(f.user, async u => {
    const identity = u['storage'].deploymentIdentity.get()!;
    u['storage'].deploymentIdentity.put(null); await u.bindDeploymentIdentity(identity);
  });
  if (mode === 'ownerABA' || mode === 'bindingABA') await runInDurableObject(f.overseer, async i => {
    if (mode === 'ownerABA') { const owner = i['impl'].ownerId; i['impl'].ownerId = 'replacement'; i['impl'].ownerId = owner; }
    else { await i.configureMilesVaultLedgerOutput(f.userId, 'replacement@example.test'); await i.configureMilesVaultLedgerOutput(f.userId, f.key); }
  });
  if (mode === 'quarantine' || mode === 'resource' || mode === 'ownerStop') await runInDurableObject(f.overseer, async (i, ctx) => {
    if (mode === 'quarantine') ctx.storage.kv.put(INSTALL_QUARANTINE_KEY, {state: 'quarantined'});
    if (mode === 'resource') i['impl'].storage.gatekeepers.delete(i['impl'].getGadgetRecord(3).bindings.LEDGER.target);
    if (mode === 'ownerStop') await i['impl'].cancelAgent(999).catch(() => {});
  });
  if (mode === 'abort') f.abort.abort();
  if (mode === 'off') f.config.NATIVE_POST_HUMAN_V2 = 'false';
  if (mode === 'renderer') f.config.NATIVE_POST_RENDERER_ARTIFACT_DIGEST = 'c'.repeat(64);
  expect((await session!.confirm(d.token)).ok).toBe(false);
  await expect((async () => await session!.confirm(d.token))()).rejects.toThrow();
  expect((await native(f.key)).transactions).toEqual([]);
  await session!.stop();
  expect((await inspect(f.key)).runs.every(r => r.finished === 1)).toBe(true);
});

it('installed private issuers and all authority selectors remain absent from host and anonymous RPC', async () => {
  const f = await fixture(); using root = new RpcStub(f.root); using session = await root.openNativePost(f.candidate);
  expect(session).not.toBeNull();
  for (const name of ['issueNativePost', 'bindNativeContext', 'checkNativePost', 'getUsageBudget', 'open', 'backend', 'broker']) {
    await expect((async () => await Reflect.get(session!, name)())()).rejects.toThrow();
  }
  expect(await root.openNativePost(f.candidate, {enabled: true})).toBeNull();
  using anonymous = new RpcStub(f.publicRoot);
  await expect((async () => await Reflect.get(anonymous, 'openNativePost')(f.candidate))()).rejects.toThrow();
  expect((await inspect(f.key)).runs).toEqual([]);
  await session!.stop();
});
