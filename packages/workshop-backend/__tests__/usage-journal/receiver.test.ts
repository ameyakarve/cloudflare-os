import {env} from 'cloudflare:workers';
import {abortAllDurableObjects, runInDurableObject} from 'cloudflare:test';
import {expect, it} from 'vitest';
import {UsageAcquisitionJournal} from '../../src/usage-acquisition-journal';
import {UsageAcquisitionReceiver, type UsageReceiverTicket} from '../../src/usage-acquisition-receiver';
import type {UsageJournalTestObject} from '../usage-journal-worker';

declare module 'cloudflare:workers' {
  interface ProvidedEnv { TEST_USAGE_JOURNAL: DurableObjectNamespace<UsageJournalTestObject>; }
}
function setup(storage: DurableObjectStorage) {
  const journal = new UsageAcquisitionJournal(storage);
  return {journal, receiver: new UsageAcquisitionReceiver(storage, journal)};
}
function ticket(receiver: UsageAcquisitionReceiver, now: number): UsageReceiverTicket {
  const snapshot = receiver.read(now);
  return {...snapshot.slots[0], namespace: snapshot.namespace, protocol: 2, owner: 'original-owner',
    incarnation: 'host-incarnation', operation: 'host-operation', payloadHash: 'a'.repeat(64),
    issuedAt: now, acquireBy: now + 5000};
}
function stub() { return env.TEST_USAGE_JOURNAL.getByName(crypto.randomUUID()); }

it('receiver fences cancel-before-begin and old cancellation cannot close a later generation', async () => {
  await runInDurableObject(stub(), (_, ctx) => {
    expect(navigator.userAgent).toBe('Cloudflare-Workers');
    const {receiver, journal} = setup(ctx.storage), now = Date.now(), old = ticket(receiver, now);
    expect(receiver.cancel(old, now)).toBe('terminal');
    expect(receiver.begin(old, now)).toBe('terminal');
    const next = ticket(receiver, now);
    expect(next.generation).toBe('1');
    expect(receiver.begin(next, now)).toBe('acquiring');
    expect(receiver.cancel(old, now)).toBe('terminal');
    expect(journal.read(next)?.state).toBe('acquiring');
    expect(receiver.matches(old, now)).toBe(false);
  });
});

it('compares every immutable field, not only the owner, generation or payload hash', async () => {
  await runInDurableObject(stub(), (_, ctx) => {
    const {receiver, journal} = setup(ctx.storage), now = Date.now(), winner = ticket(receiver, now);
    expect(receiver.begin(winner, now)).toBe('acquiring');
    const changes = [{owner: 'other'}, {operation: 'other'}, {incarnation: 'other'},
      {payloadHash: 'b'.repeat(64)}, {issuedAt: now - 1, acquireBy: now + 4999}, {acquireBy: now + 4999}];
    for (const change of changes) {
      const loser = {...winner, ...change};
      expect(receiver.begin(loser, now)).toBe('conflict');
      expect(receiver.cancel(loser, now)).toBe('terminal');
      expect(receiver.matches(loser, now)).toBe(false);
      expect(journal.read(winner)?.state).toBe('acquiring');
    }
    expect(receiver.begin({...winner}, now + 1)).toBe('acquiring');
    expect(receiver.begin({...winner, namespace: crypto.randomUUID()}, now)).toBe('invalid');
    expect(receiver.cancel({...winner, generation: '1'}, now)).toBe('invalid');
  });
});

it('claims ticket and journal atomically and rejects malformed data without fencing', async () => {
  await runInDurableObject(stub(), (_, ctx) => {
    const {receiver, journal} = setup(ctx.storage), now = Date.now(), candidate = ticket(receiver, now);
    expect(() => receiver.begin({...candidate, payloadHash: 'bad'}, now)).toThrow();
    expect(journal.available()[0].generation).toBe('0');
    ctx.storage.sql.exec(`CREATE TRIGGER fail_receiver BEFORE UPDATE ON usage_receiver_tickets_v2
      BEGIN SELECT RAISE(ABORT, 'injected receiver write failure'); END`);
    expect(() => receiver.begin(candidate, now)).toThrow();
    expect(journal.records()).toHaveLength(0);
    expect(receiver.status(candidate)).toBe('free');
    ctx.storage.sql.exec('DROP TRIGGER fail_receiver');
    expect(receiver.begin(candidate, now)).toBe('acquiring');
  });
});

it('retains the same original cleanup row after cancellation, with no capacity needed to close', async () => {
  await runInDurableObject(stub(), async (_, ctx) => {
    const {receiver, journal} = setup(ctx.storage), now = Date.now();
    const candidates: UsageReceiverTicket[] = [];
    for (let i = 0; i < 20; i++) {
      const candidate = ticket(receiver, now);
      candidates.push(candidate);
      expect(receiver.begin(candidate, now)).toBe('acquiring');
      journal.attach(candidate, {deployment: 'old-deployment', owner: 'old-user-do',
        key: 'ExactCase@example.test', ticket: JSON.stringify({syntheticCleanupOnly: i})}, now);
    }
    expect(receiver.read(now).slots).toHaveLength(0);
    for (const candidate of candidates) expect(receiver.cancel(candidate, now)).toBe('terminal');
    await journal.drain(async () => false, now);
    expect(journal.records()).toHaveLength(20);
    expect(receiver.read(now).slots).toHaveLength(0);
    await journal.drain(async target => target.key === 'ExactCase@example.test', now + 1000);
    expect(receiver.read(now + 1000).slots).toHaveLength(20);
    expect(ctx.storage.sql.exec('SELECT * FROM usage_receiver_tickets_v2').toArray()).toHaveLength(20);
    for (const candidate of candidates) expect(receiver.begin(candidate, now + 1000)).toBe('terminal');
  });
});

it('late duplicate begins and changed retry deadlines never renew a claim', async () => {
  await runInDurableObject(stub(), (_, ctx) => {
    const {receiver} = setup(ctx.storage), now = Date.now(), candidate = ticket(receiver, now);
    expect(receiver.begin(candidate, now)).toBe('acquiring');
    expect(receiver.begin({...candidate, issuedAt: now + 1, acquireBy: now + 5001}, now + 1)).toBe('conflict');
    expect(receiver.begin(candidate, now + 5000)).toBe('terminal');
    expect(receiver.matches(candidate, now + 5000)).toBe(false);
  });
});

it('maximum generation can close and seal without wrap or new capacity', async () => {
  await runInDurableObject(stub(), (_, ctx) => {
    const {receiver} = setup(ctx.storage), now = Date.now(), candidate = ticket(receiver, now);
    ctx.storage.sql.exec('UPDATE usage_caller_slots_v2 SET generation = 9223372036854775807 WHERE slot = 0');
    const max = {...candidate, generation: '9223372036854775807'};
    expect(receiver.begin(max, now)).toBe('invalid');
    expect(receiver.cancel(max, now)).toBe('terminal');
    expect(receiver.status(max)).toBe('terminal');
    expect(receiver.read(now).slots).toHaveLength(19);
  });
});

it('real eviction preserves epoch, full winning ticket, and permanent fences', async () => {
  const name = crypto.randomUUID();
  const candidate = await runInDurableObject(env.TEST_USAGE_JOURNAL.getByName(name), (_, ctx) => {
    const {receiver} = setup(ctx.storage), now = Date.now(), created = ticket(receiver, now);
    receiver.begin(created, now);
    return created;
  });
  await abortAllDurableObjects();
  await runInDurableObject(env.TEST_USAGE_JOURNAL.getByName(name), (_, ctx) => {
    const {receiver} = setup(ctx.storage);
    expect(receiver.namespace).toBe(candidate.namespace);
    expect(receiver.status(candidate)).toBe('acquiring');
    expect(receiver.cancel({...candidate, owner: 'loser'}, Date.now())).toBe('terminal');
    expect(receiver.status(candidate)).toBe('acquiring');
    receiver.cancel(candidate, Date.now());
    expect(receiver.status(candidate)).toBe('terminal');
  });
});
