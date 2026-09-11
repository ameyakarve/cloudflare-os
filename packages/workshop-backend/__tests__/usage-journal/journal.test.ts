import {env} from 'cloudflare:workers';
import {abortAllDurableObjects, runInDurableObject} from 'cloudflare:test';
import {expect, it} from 'vitest';
import {UsageAcquisitionJournal, type UsageCleanupTarget} from '../../src/usage-acquisition-journal';
import type {UsageJournalTestObject} from '../usage-journal-worker';

declare module 'cloudflare:workers' {
  interface ProvidedEnv { TEST_USAGE_JOURNAL: DurableObjectNamespace<UsageJournalTestObject>; }
}
const intent = (now: number) => ({owner: 'original-owner', incarnation: 'stop-epoch-1', operation: 'host-operation',
  issuedAt: now, acquireBy: now + 5000});
const target: UsageCleanupTarget = {deployment: 'original-deployment', owner: 'original-user-do',
  key: 'ExactCase@example.test', ticket: '{"complete":"immutable-private-wire-ticket"}'};
function stub() { return env.TEST_USAGE_JOURNAL.getByName(crypto.randomUUID()); }

it('uses native SQLite, twenty fixed rows, immutable intent and before-send target', async () => {
  await runInDurableObject(stub(), async (_, ctx) => {
    expect(navigator.userAgent).toBe('Cloudflare-Workers');
    const j = new UsageAcquisitionJournal(ctx.storage), now = Date.now(), id = j.available()[0];
    expect(j.available()).toHaveLength(20);
    expect(j.claim(id, intent(now), now)).toBe(true);
    expect(j.claim(id, {...intent(now), incarnation: 'new-epoch'}, now)).toBe(false);
    expect(j.claim(id, intent(now), now + 1)).toBe(true);
    expect(j.attach(id, target, now)).toBe(true);
    expect(j.attach(id, {...target, key: 'changed'}, now)).toBe(false);
    await j.arm();
    expect(await ctx.storage.getAlarm()).toBe(now + 5000);
    expect(new UsageAcquisitionJournal(ctx.storage).read(id)?.remote).toEqual(target);
    expect(ctx.storage.sql.exec('SELECT * FROM usage_caller_slots_v2').toArray()).toHaveLength(20);
  });
});

it('cancel-before-claim and stale continuations cannot claim, attach or adopt', async () => {
  await runInDurableObject(stub(), (_, ctx) => {
    const j = new UsageAcquisitionJournal(ctx.storage), now = Date.now(), id = j.available()[0];
    expect(j.close(id, now)).toBe(true);
    expect(j.claim(id, intent(now), now)).toBe(false);
    const next = j.available()[0];
    expect(next.generation).toBe('1');
    expect(j.claim(next, intent(now), now)).toBe(true);
    expect(j.close(id, now)).toBe(true);
    expect(j.attach(id, target, now)).toBe(false);
    expect(j.adopted(id, now)).toBe(false);
    expect(j.read(next)?.state).toBe('acquiring');
  });
});

it('adoption is ordered, expiry immutable and duplicate adoption cannot renew its deadline', async () => {
  await runInDurableObject(stub(), (_, ctx) => {
    const j = new UsageAcquisitionJournal(ctx.storage), now = Date.now(), id = j.available()[0];
    j.claim(id, intent(now), now); j.attach(id, target, now);
    expect(j.adopted(id, now)).toBe(false);
    expect(j.pending(id, now + 180000, now)).toBe(true);
    expect(j.pending(id, now + 180001, now)).toBe(false);
    expect(j.adopting(id, now + 4999)).toBe(true);
    expect(j.adopted(id, now + 4999)).toBe(true);
    expect(j.adopted(id, now + 4999)).toBe(true);
    expect(j.adopted(id, now + 5000)).toBe(false);
    j.recover(now + 5000);
    expect(j.read(id)?.state).toBe('adopted');
    expect(j.nextAlarm()).toBe(now + 180000);
    j.recover(now + 180000);
    expect(j.read(id)?.state).toBe('cleaning');
  });
});

it('short configured expiry and exact acquisition boundary fail closed', async () => {
  await runInDurableObject(stub(), (_, ctx) => {
    const j = new UsageAcquisitionJournal(ctx.storage), now = Date.now(), [short, late] = j.available();
    j.claim(short, intent(now), now); j.attach(short, target, now);
    expect(j.pending(short, now + 1000, now)).toBe(true);
    expect(j.nextAlarm()).toBe(now + 1000);
    expect(j.adopting(short, now + 1000)).toBe(false);
    j.claim(late, intent(now), now); j.attach(late, target, now);
    expect(j.pending(late, now + 180000, now + 5000)).toBe(false);
    j.recover(now + 5000);
    expect(j.records().every(r => r.state === 'cleaning')).toBe(true);
  });
});

it.each(['0', '9223372036854775806'])('closing advanced fence preserves unacknowledged cleanup from generation %s', async generation => {
  await runInDurableObject(stub(), async (_, ctx) => {
    const j = new UsageAcquisitionJournal(ctx.storage), now = Date.now();
    ctx.storage.sql.exec('UPDATE usage_caller_slots_v2 SET generation = CAST(? AS INTEGER) WHERE slot = 0', generation);
    const original = {slot: 0, generation};
    expect(j.claim(original, intent(now), now)).toBe(true);
    expect(j.attach(original, target, now)).toBe(true);
    expect(j.close(original, now)).toBe(true);
    const before = ctx.storage.sql.exec('SELECT * FROM usage_caller_slots_v2').toArray();
    const advanced = {slot: 0, generation: String(BigInt(generation) + 1n)};
    expect(j.close(advanced, now + 1)).toBe(false);
    expect(ctx.storage.sql.exec('SELECT * FROM usage_caller_slots_v2').toArray()).toEqual(before);
    const reopened = new UsageAcquisitionJournal(ctx.storage);
    expect(reopened.read(original)?.remote).toEqual(target);
    expect(reopened.available().some(candidate => candidate.slot === 0)).toBe(false);
    await reopened.drain(async remote => { expect(remote).toEqual(target); return false; }, now);
    expect(reopened.read(original)?.state).toBe('cleaning');
    expect(reopened.close(advanced, now + 2)).toBe(false);
    expect(reopened.read(original)?.remote).toEqual(target);
    await reopened.drain(async remote => { expect(remote).toEqual(target); return true; }, now + 100000);
    expect(reopened.records()).toHaveLength(0);
  });
});

it('all slots can be cleaning; failures retain original routing without capacity or roles', async () => {
  await runInDurableObject(stub(), async (_, ctx) => {
    const j = new UsageAcquisitionJournal(ctx.storage), now = Date.now();
    for (const id of j.available()) {
      j.claim(id, {...intent(now), operation: `op-${id.slot}`}, now);
      j.attach(id, target, now); j.close(id, now);
    }
    expect(j.available()).toHaveLength(0);
    await j.drain(async original => { expect(original).toEqual(target); throw new Error('lost ack'); }, now);
    expect(j.records()).toHaveLength(20);
    expect(j.records().every(r => r.retries === 1 && r.retryAt === now + 500)).toBe(true);
    await j.drain(async original => { expect(original).toEqual(target); return true; }, now + 500);
    expect(j.records()).toHaveLength(0);
    expect(j.available()).toHaveLength(20);
    expect(j.available().every(r => r.generation === '1')).toBe(true);
    expect(ctx.storage.sql.exec('SELECT * FROM usage_caller_slots_v2').toArray()).toHaveLength(20);
  });
});

it('never-settling cleanup is bounded and late acknowledgement cannot drop the obligation', async () => {
  await runInDurableObject(stub(), async (_, ctx) => {
    const j = new UsageAcquisitionJournal(ctx.storage), now = Date.now(), id = j.available()[0];
    j.claim(id, intent(now), now); j.attach(id, target, now); j.close(id, now);
    let reply!: (ack: boolean) => void;
    await j.drain(() => new Promise(resolve => { reply = resolve; }), now);
    reply(true);
    await Promise.resolve();
    expect(j.read(id)?.state).toBe('cleaning');
    await j.drain(async () => true, now + 2000);
    expect(j.read(id)).toBeUndefined();
  });
});

it('reopens committed obligations after actual eviction, retaining original key and epoch', async () => {
  const object = stub();
  await runInDurableObject(object, async (_, ctx) => {
    const j = new UsageAcquisitionJournal(ctx.storage), now = Date.now(), id = j.available()[0];
    j.claim(id, intent(now), now); j.attach(id, target, now); await j.arm();
    await ctx.storage.sync();
  });
  await abortAllDurableObjects();
  const reopened = env.TEST_USAGE_JOURNAL.get(object.id);
  expect((await reopened.snapshot())[0].remote).toEqual(target);
  await runInDurableObject(reopened, async (_, ctx) => {
    const j = new UsageAcquisitionJournal(ctx.storage), now = Date.now();
    j.recover(now, true);
    expect(j.records()[0].state).toBe('cleaning');
    await j.drain(async original => { expect(original).toEqual(target); return true; }, now);
    expect(j.available()).toHaveLength(20);
  });
});

it('maximum generation seals on close with and without a downstream obligation', async () => {
  await runInDurableObject(stub(), async (_, ctx) => {
    const j = new UsageAcquisitionJournal(ctx.storage), now = Date.now();
    ctx.storage.sql.exec("UPDATE usage_caller_slots_v2 SET generation = 9223372036854775806 WHERE slot IN (0,1)");
    const ids = j.available().slice(0, 2);
    j.claim(ids[0], intent(now), now); j.attach(ids[0], target, now);
    j.close(ids[0], now); j.close(ids[1], now);
    await j.drain(async () => true, now);
    expect(j.available()).toHaveLength(18);
    const rows = ctx.storage.sql.exec('SELECT CAST(generation AS TEXT) AS generation, state FROM usage_caller_slots_v2 WHERE slot IN (0,1)').toArray();
    expect(rows).toEqual([{generation: '9223372036854775807', state: 'sealed'}, {generation: '9223372036854775807', state: 'sealed'}]);
    expect(j.close({slot: 0, generation: '9223372036854775807'}, now)).toBe(true);
  });
});

it('SQL failure rolls back local closure and its fence together', async () => {
  await runInDurableObject(stub(), (_, ctx) => {
    const j = new UsageAcquisitionJournal(ctx.storage), now = Date.now(), id = j.available()[0];
    j.claim(id, intent(now), now); j.attach(id, target, now);
    ctx.storage.sql.exec(`CREATE TRIGGER fail_usage_close BEFORE UPDATE ON usage_caller_slots_v2
      WHEN NEW.state = 'cleaning' BEGIN SELECT RAISE(ABORT, 'injected'); END`);
    expect(() => j.close(id, now)).toThrow('injected');
    expect(j.read(id)?.state).toBe('acquiring');
    expect(ctx.storage.sql.exec('SELECT generation FROM usage_caller_slots_v2 WHERE slot = 0').one().generation).toBe(0);
    ctx.storage.sql.exec('DROP TRIGGER fail_usage_close');
    expect(j.close(id, now)).toBe(true);
  });
});

it('alarm persistence failure prevents publication while the flushed tuple remains recoverable', async () => {
  await runInDurableObject(stub(), async (_, ctx) => {
    const j = new UsageAcquisitionJournal(ctx.storage), now = Date.now(), id = j.available()[0];
    j.claim(id, intent(now), now); j.attach(id, target, now);
    await ctx.storage.sync();
    const setAlarm = ctx.storage.setAlarm.bind(ctx.storage);
    ctx.storage.setAlarm = async () => { throw new Error('injected alarm failure'); };
    let sends = 0;
    try {
      await expect((async () => { await j.arm(); sends++; })()).rejects.toThrow('injected');
      expect(sends).toBe(0);
      expect(new UsageAcquisitionJournal(ctx.storage).read(id)?.remote).toEqual(target);
    } finally { ctx.storage.setAlarm = setAlarm; }
    j.recover(now, true);
    await j.drain(async () => true, now);
    expect(j.available()).toHaveLength(20);
  });
});

it('repeated generations stay bounded and an old cancellation never closes the replacement', async () => {
  await runInDurableObject(stub(), async (_, ctx) => {
    const j = new UsageAcquisitionJournal(ctx.storage), now = Date.now();
    const original = j.available()[0];
    for (let generation = 0; generation < 100; generation++) {
      const id = j.available()[0];
      expect(id.generation).toBe(String(generation));
      j.claim(id, {...intent(now), operation: `op-${generation}`}, now);
      j.attach(id, target, now);
      if (generation > 0) {
        j.close(original, now);
        expect(j.read(id)?.state).toBe('acquiring');
      }
      j.close(id, now);
      await j.drain(async () => true, now);
      expect(j.records()).toHaveLength(0);
      expect(ctx.storage.sql.exec('SELECT * FROM usage_caller_slots_v2').toArray()).toHaveLength(20);
    }
  });
});

it('preserves earlier shared alarms and refuses malformed/unbounded records', async () => {
  await runInDurableObject(stub(), async (_, ctx) => {
    const j = new UsageAcquisitionJournal(ctx.storage), now = Date.now(), id = j.available()[0];
    j.claim(id, intent(now), now);
    await ctx.storage.setAlarm(now + 1000); await j.arm();
    expect(await ctx.storage.getAlarm()).toBe(now + 1000);
    expect(() => j.attach(id, {...target, ticket: 'x'.repeat(4097)}, now)).toThrow();
    expect(() => j.close({slot: 0, generation: '01'}, now)).toThrow();
    expect(() => j.claim(id, {...intent(now), owner: 'x'.repeat(129)}, now)).toThrow();
    expect(j.claim(j.available()[0], {...intent(now), acquireBy: now + 5001}, now)).toBe(false);
  });
});
