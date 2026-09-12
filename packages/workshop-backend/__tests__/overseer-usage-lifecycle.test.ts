import { env, RpcStub, RpcTarget } from 'cloudflare:workers';
import { abortAllDurableObjects, runInDurableObject } from 'cloudflare:test';
import { expect, it, vi } from 'vitest';
import type { OverseerDurableObject } from '../src/overseer.js';

declare global {
  namespace Cloudflare {
    interface Env { TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>; }
  }
}

const target = {deployment: 'retained-original-route', owner: 'original-user', key: 'original-user', ticket: 'complete-original-ticket'};

it('actual Overseer persists owner ABA, execution linkage and Stop closure without redirecting cleanup', async () => {
  const name = crypto.randomUUID();
  let incarnation = '';
  await runInDurableObject(env.TEST_OVERSEER.getByName(name), async instance => {
    const impl = instance['impl'];
    impl.ownerId = 'A'; impl.storage.ownerId.put('A');
    const life = impl.usageLifecycle;
    incarnation = life.identity.incarnation;
    const now = Date.now();
    const id = life.journal.available()[0];
    expect(life.claim(id, {owner: 'A', incarnation, operation: 'op', issuedAt: now, acquireBy: now + 5000}, {chat: 7, id: 'execution'})).toBe(true);
    expect(life.journal.attach(id, target, now)).toBe(true);
    await life.journal.arm();
    impl.ownerId = 'B'; impl.ownerId = 'A';
    expect(life.identity.incarnation).not.toBe(incarnation);
    expect(life.journal.read(id)).toMatchObject({state: 'cleaning', remote: target});
    const second = life.journal.available()[0];
    expect(life.claim(second, {owner: 'A', incarnation: life.identity.incarnation, operation: 'stop', issuedAt: now, acquireBy: now + 5000}, {chat: 8, id: 'stopped'})).toBe(true);
    life.journal.attach(second, target, now);
    await impl.cancelAgent(8);
    expect(life.journal.read(second)?.state).toBe('cleaning');
    expect(life.journal.attach(second, {...target, owner: 'replacement'}, Date.now())).toBe(false);
    expect(life.journal.adopted(second, Date.now())).toBe(false);
    incarnation = life.identity.incarnation;
  });
  await abortAllDurableObjects();
  await runInDurableObject(env.TEST_OVERSEER.getByName(name), async instance => {
    const life = instance['impl'].usageLifecycle;
    expect(life.identity.incarnation).toBe(incarnation);
    expect(life.journal.records()).toHaveLength(2);
    expect(life.journal.records().every(r => r.state === 'cleaning' && r.remote?.owner === target.owner)).toBe(true);
  });
});

it('actual wake closes interrupted acquisitions and retains lost cleanup with a retry alarm', async () => {
  const name = crypto.randomUUID();
  await runInDurableObject(env.TEST_OVERSEER.getByName(name), async instance => {
    const impl = instance['impl'];
    impl.ownerId = 'A'; impl.storage.ownerId.put('A');
    const life = impl.usageLifecycle;
    const now = Date.now();
    const id = life.journal.available()[0];
    life.claim(id, {owner: 'A', incarnation: life.identity.incarnation, operation: 'interrupted', issuedAt: now, acquireBy: now + 5000});
    life.journal.attach(id, target, now);
    await life.journal.arm();
  });
  await abortAllDurableObjects();
  await runInDurableObject(env.TEST_OVERSEER.getByName(name), async (instance, ctx) => {
    const impl = instance['impl'];
    expect(impl.usageLifecycle.journal.records()[0].state).toBe('cleaning');
    await instance.alarm(); // original route unavailable: actual transport fails closed
    const record = impl.usageLifecycle.journal.records()[0];
    expect(record.retries).toBe(1);
    expect(record.remote).toEqual(target);
    // Delivered retention used to overwrite a sooner cleanup retry.
    impl.storage.gadgetResponseDeliveries.put({idempotencyKey: 'synthetic-delivery', chatId: 9,
      promptSequence: 1, createdAt: Date.now(), status: 'delivered', deliveredAt: Date.now()});
    await impl.updateSharedAlarm();
    expect(await ctx.storage.getAlarm()).toBe(record.retryAt);
    impl.storage.gadgetResponseDeliveries.delete('synthetic-delivery');
    class SyntheticResponse extends RpcTarget { async onGadgetResponse() {} }
    using response = new RpcStub(new SyntheticResponse());
    // Synthetic ready-index data exercises the real scheduler, not gateway transport.
    const ready = vi.spyOn(impl.storage.gadgetResponseDeliveries.readyByIdempotencyKey, 'list').mockReturnValue([
      {idempotencyKey: 'synthetic-ready', chatId: 9, promptSequence: 1, createdAt: Date.now(),
        status: 'ready', responseText: '', chatGatewayRpcTarget: response},
    ]);
    try {
      await impl.updateSharedAlarm();
      expect(await ctx.storage.getAlarm()).toBeLessThanOrEqual(record.retryAt);
    } finally { ready.mockRestore(); }
    await impl.updateSharedAlarm(); // no agents or deliveries: formerly deleted the alarm
    expect(await ctx.storage.getAlarm()).toBe(record.retryAt);
    // Local lifecycle-only lost acknowledgement after a synthetic terminal effect.
    await impl.usageLifecycle.journal.drain(async original => {
      expect(original).toEqual(target);
      throw new Error('synthetic terminal acknowledgement lost');
    }, record.retryAt);
    const retry = impl.usageLifecycle.journal.records()[0];
    expect(retry.retries).toBe(2);
    expect(retry.remote).toEqual(target);
    // Local lifecycle-only synthetic terminal acknowledgement, not User/M acceptance.
    await impl.usageLifecycle.journal.drain(async original => {
      expect(original).toEqual(target); return true;
    }, retry.retryAt);
    await impl.updateSharedAlarm();
    expect(impl.usageLifecycle.journal.records()).toHaveLength(0);
    expect(await ctx.storage.getAlarm()).toBeNull();
  });
});

it('agent keepalive and teardown cannot postpone/delete cleanup; alarm cleans before live-agent wait', async () => {
  await runInDurableObject(env.TEST_OVERSEER.getByName(crypto.randomUUID()), async (instance, ctx) => {
    const impl = instance['impl'];
    impl.ownerId = 'A';
    const life = impl.usageLifecycle;
    const now = Date.now();
    const id = life.journal.available()[0];
    life.claim(id, {owner: 'A', incarnation: life.identity.incarnation, operation: 'alarm', issuedAt: now, acquireBy: now + 5000}, {chat: 7, id: 'replaced-execution'});
    life.journal.attach(id, target, now);
    life.journal.pending(id, now + 60000, now);
    life.journal.adopting(id, now);
    life.journal.adopted(id, now);
    const admission = vi.spyOn(impl, 'newUsageScope').mockReturnValue(new Promise(() => {}));
    const waiter = vi.spyOn(impl.ctx, 'waitUntil').mockImplementation(() => {});
    try {
      impl.startAgent(7, {profile: {type: 'agent', id: 'fixture', name: 'Fixture'}, config: {provider: 'openai', model: 'gpt-4.1', apiToken: 'unused'}},
        {type: 'user', id: 'synthetic', name: 'Synthetic'}, 'unused', false, true);
      expect(life.journal.read(id)?.state).toBe('cleaning');
      expect(life.journal.adopted(id, Date.now())).toBe(false);
      await impl.updateSharedAlarm();
      expect(await ctx.storage.getAlarm()).toBeLessThanOrEqual(Date.now());
      await instance.alarm();
      expect(life.journal.records()[0].retries).toBe(1);
      expect(await ctx.storage.getAlarm()).toBe(life.journal.nextAlarm());
      impl.storage.activeAgents.delete(7);
      impl.destroyLiveChat(7);
      await impl.updateSharedAlarm();
      expect(await ctx.storage.getAlarm()).toBe(life.journal.nextAlarm());
    } finally { admission.mockRestore(); waiter.mockRestore(); }
  });
});
