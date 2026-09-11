import { UsageAcquisitionJournal, type UsageCandidate, type UsageCallerIntent } from './usage-acquisition-journal.js';

/** Private host ticket. Not a browser interface, M ticket, or usable quota grant. */
export type UsageReceiverTicket = UsageCandidate & UsageCallerIntent & {
  protocol: 2;
  namespace: string;
  payloadHash: string;
};

/** Recovery information only. No status, including adopted, grants dispatch authority. */
export type UsageReceiverStatus = 'free' | 'acquiring' | 'pending' | 'adopting' |
  'adopted' | 'cleaning' | 'terminal' | 'conflict' | 'invalid';

const MAX_GENERATION = 9223372036854775807n;
const fields = ['acquireBy', 'generation', 'incarnation', 'issuedAt', 'namespace',
  'operation', 'owner', 'payloadHash', 'protocol', 'slot'];

function serialize(ticket: UsageReceiverTicket): string {
  if (!ticket || Object.keys(ticket).toSorted().join() !== fields.join() || ticket.protocol !== 2 ||
      typeof ticket.namespace !== 'string' || !/^[a-f0-9-]{36}$/.test(ticket.namespace) ||
      !Number.isInteger(ticket.slot) || ticket.slot < 0 || ticket.slot >= 20 ||
      typeof ticket.generation !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(ticket.generation) ||
      BigInt(ticket.generation) > MAX_GENERATION ||
      typeof ticket.payloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(ticket.payloadHash) ||
      !Number.isSafeInteger(ticket.issuedAt) || ticket.issuedAt < 0 ||
      !Number.isSafeInteger(ticket.acquireBy) || ticket.acquireBy <= ticket.issuedAt ||
      ticket.acquireBy - ticket.issuedAt > 5000) throw new TypeError('Invalid usage receiver ticket');
  for (const value of [ticket.owner, ticket.operation, ticket.incarnation]) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 128 || value.includes('\0')) {
      throw new TypeError('Invalid usage receiver identity');
    }
  }
  // Canonical field order; object property order is not part of immutable ticket identity.
  return JSON.stringify(fields.map(field => ticket[field as keyof UsageReceiverTicket]));
}

/**
 * Full-ticket receiver fence over the unchanged caller journal's twenty slots. The fixed metadata
 * row paired with each journal row remembers the complete upstream ticket, not just its digest.
 * This module performs no RPC, role check, adoption or authority issuance. A coordinator must own
 * those operations and arm the journal before sending anything. Never expose journal.close() to
 * a remote caller: only this exact-ticket cancellation path handles conflicting candidates.
 */
export class UsageAcquisitionReceiver {
  readonly namespace: string;
  constructor(private readonly storage: DurableObjectStorage,
      private readonly journal: UsageAcquisitionJournal) {
    this.namespace = storage.transactionSync(() => {
      storage.sql.exec(`CREATE TABLE IF NOT EXISTS usage_receiver_epoch_v2 (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1), namespace TEXT NOT NULL
      )`);
      storage.sql.exec('INSERT OR IGNORE INTO usage_receiver_epoch_v2 VALUES (1, ?)', crypto.randomUUID());
      storage.sql.exec(`CREATE TABLE IF NOT EXISTS usage_receiver_tickets_v2 (
        slot INTEGER PRIMARY KEY CHECK(slot >= 0 AND slot < 20),
        ticket TEXT CHECK(ticket IS NULL OR length(ticket) <= 2048)
      )`);
      for (let slot = 0; slot < 20; slot++) {
        storage.sql.exec('INSERT OR IGNORE INTO usage_receiver_tickets_v2 VALUES (?, NULL)', slot);
      }
      return storage.sql.exec<{namespace: string}>(
        'SELECT namespace FROM usage_receiver_epoch_v2 WHERE singleton = 1').one().namespace;
    });
  }

  /** Sweep local expiry, then return payload-free candidates; losing a read reply leaks nothing. */
  read(now: number): {protocol: 2; namespace: string; slots: UsageCandidate[]} {
    this.journal.recover(now);
    return {protocol: 2, namespace: this.namespace, slots: this.journal.available()};
  }

  private stored(slot: number): string | null {
    return this.storage.sql.exec<{ticket: string | null}>(
      'SELECT ticket FROM usage_receiver_tickets_v2 WHERE slot = ?', slot).one().ticket;
  }

  /** Exact-match lookup only; never acquires, activates, renews, or treats pending as authority. */
  status(ticket: UsageReceiverTicket): UsageReceiverStatus {
    const bytes = serialize(ticket);
    if (ticket.namespace !== this.namespace) return 'invalid';
    const record = this.journal.read(ticket);
    if (record) return this.stored(ticket.slot) === bytes ? record.state : 'conflict';
    const row = this.storage.sql.exec<{generation: string; state: string}>(
      'SELECT CAST(generation AS TEXT) AS generation, state FROM usage_caller_slots_v2 WHERE slot = ?',
      ticket.slot).one();
    if (BigInt(ticket.generation) > BigInt(row.generation)) return 'invalid';
    if (BigInt(ticket.generation) < BigInt(row.generation) || row.state === 'sealed') return 'terminal';
    return row.state === 'free' ? 'free' : 'conflict';
  }

  /** Claim exact upstream ticket before any external await. Changed retries cannot inherit a claim. */
  begin(ticket: UsageReceiverTicket, now: number): UsageReceiverStatus {
    const bytes = serialize(ticket);
    return this.storage.transactionSync(() => {
      this.journal.recover(now);
      const status = this.status(ticket);
      if (status !== 'free') return status;
      if (!this.journal.claim({slot: ticket.slot, generation: ticket.generation}, ticket, now)) return 'invalid';
      this.storage.sql.exec('UPDATE usage_receiver_tickets_v2 SET ticket = ? WHERE slot = ?', bytes, ticket.slot);
      return 'acquiring';
    });
  }

  /**
   * Terminal means this candidate cannot gain authority, not that remote cleanup has finished.
   * A losing same-generation cancellation acknowledges its own loss without closing the winner.
   * Expired tickets remain closeable, including at the generation ceiling and without role access.
   */
  cancel(ticket: UsageReceiverTicket, now: number): 'terminal' | 'invalid' {
    serialize(ticket);
    return this.storage.transactionSync(() => {
      const status = this.status(ticket);
      if (status === 'invalid') return 'invalid';
      if (status === 'terminal' || status === 'conflict') return 'terminal';
      return this.journal.close(ticket, now) ? 'terminal' : 'invalid';
    });
  }

  /** Compare the full current ticket before a coordinator acts on a journal continuation. */
  matches(ticket: UsageReceiverTicket, now: number): boolean {
    this.journal.recover(now);
    const status = this.status(ticket);
    return status === 'acquiring' || status === 'pending' || status === 'adopting' || status === 'adopted';
  }
}
