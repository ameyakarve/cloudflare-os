/**
 * Usage-only durable caller journal. User V2 owns the transport; Overseer is not wired yet.
 * Journal records are not authority. The transport validates proofs from the generated M contract.
 * Opaque ticket bytes here are the complete serialized ticket, never an RPC interface mirror.
 */
const SLOT_COUNT = 20; // M OS_MAX_CONCURRENT_RUNS: existing supported maximum, not a quota.
const MAX_GENERATION = 9223372036854775807n;

/** Private host-selected fence, never accepted from browser capabilities. */
export type UsageCandidate = { slot: number; generation: string };
/** Immutable host intent. Incarnation must change on Stop/identity replacement, including ABA. */
export type UsageCallerIntent = {
  owner: string;
  incarnation: string;
  operation: string;
  issuedAt: number;
  acquireBy: number;
};
/** Original routing and complete wire payload. Cleanup must never resolve the current identity. */
export type UsageCleanupTarget = {
  deployment: string;
  owner: string;
  key: string;
  ticket: string;
};
/** Durable recovery data only; adopted does not itself confer reserve/dispatch permission. */
export type UsageJournalRecord = UsageCandidate & {
  state: 'acquiring' | 'pending' | 'adopting' | 'adopted' | 'cleaning';
  intent: UsageCallerIntent;
  remote?: UsageCleanupTarget;
  expiresAt?: number;
  retryAt: number;
  retries: number;
};
type Row = {
  slot: number; generation: string; state: string; record: string | null;
};

function bounded(value: string, max: number) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || value.includes('\0')) {
    throw new TypeError('Invalid usage journal field');
  }
}
function candidate(value: UsageCandidate) {
  if (!Number.isInteger(value.slot) || value.slot < 0 || value.slot >= SLOT_COUNT ||
      !/^(0|[1-9][0-9]{0,18})$/.test(value.generation) || BigInt(value.generation) > MAX_GENERATION) {
    throw new TypeError('Invalid usage journal fence');
  }
}
function timestamp(now: number) {
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('Invalid usage journal time');
}

/**
 * Exactly twenty permanent SQLite rows, one obligation per row. No append-only tombstones.
 * All local transitions are synchronous transactions; no RPC may be sent until arm() succeeds.
 * The owning DO must run recover() on wake and merge nextAlarm() into its shared alarm scheduler.
 */
export class UsageAcquisitionJournal {
  constructor(private readonly storage: DurableObjectStorage,
      private readonly schedule: (operation: () => Promise<void>) => Promise<void> = operation => operation()) {
    storage.transactionSync(() => {
      storage.sql.exec(`CREATE TABLE IF NOT EXISTS usage_caller_slots_v2 (
        slot INTEGER PRIMARY KEY CHECK(slot >= 0 AND slot < 20),
        generation INTEGER NOT NULL CHECK(generation >= 0),
        state TEXT NOT NULL CHECK(state IN ('free','occupied','cleaning','sealed')),
        record TEXT CHECK(record IS NULL OR length(record) <= 12000),
        CHECK((state IN ('free','sealed') AND record IS NULL) OR
              (state IN ('occupied','cleaning') AND record IS NOT NULL))
      )`);
      for (let slot = 0; slot < SLOT_COUNT; slot++) {
        storage.sql.exec("INSERT OR IGNORE INTO usage_caller_slots_v2 VALUES (?, 0, 'free', NULL)", slot);
      }
    });
  }

  private rows(): Row[] {
    return this.storage.sql.exec<Row>(
      'SELECT slot, CAST(generation AS TEXT) AS generation, state, record FROM usage_caller_slots_v2 ORDER BY slot',
    ).toArray();
  }
  private save(record: UsageJournalRecord) {
    const json = JSON.stringify(record);
    if (json.length > 12000) throw new TypeError('Usage journal record too large');
    this.storage.sql.exec('UPDATE usage_caller_slots_v2 SET record = ? WHERE slot = ?', json, record.slot);
  }

  /** Payload-free allocation snapshot. Reading never allocates; max generation is never offered. */
  available(): UsageCandidate[] {
    return this.rows().filter(r => r.state === 'free' && BigInt(r.generation) < MAX_GENERATION)
      .map(({slot, generation}) => ({slot, generation}));
  }

  /** Detached snapshots survive eviction; editing a returned object cannot edit persisted intent. */
  records(): UsageJournalRecord[] {
    return this.rows().filter(r => r.record !== null).map(r => JSON.parse(r.record!) as UsageJournalRecord);
  }

  /** Exact original generation, even while a cleaning row holds an already-advanced local fence. */
  read(id: UsageCandidate): UsageJournalRecord | undefined {
    candidate(id);
    return this.records().find(r => r.slot === id.slot && r.generation === id.generation);
  }

  /** Claim before access/snapshot awaits. Changed duplicates are refused; no retry renews time. */
  claim(id: UsageCandidate, intent: UsageCallerIntent, now: number): boolean {
    candidate(id); timestamp(now);
    for (const value of [intent.owner, intent.incarnation, intent.operation]) bounded(value, 128);
    timestamp(intent.issuedAt); timestamp(intent.acquireBy);
    if (intent.issuedAt > now || now >= intent.acquireBy || intent.acquireBy <= intent.issuedAt ||
        intent.acquireBy - intent.issuedAt > 5000) return false;
    // Explicit field order prevents object property order from changing idempotency.
    const frozen = {owner: intent.owner, incarnation: intent.incarnation, operation: intent.operation,
      issuedAt: intent.issuedAt, acquireBy: intent.acquireBy};
    return this.storage.transactionSync(() => {
      const old = this.read(id);
      if (old) return old.state !== 'cleaning' && JSON.stringify(old.intent) === JSON.stringify(frozen);
      const row = this.rows()[id.slot];
      if (row.state !== 'free' || row.generation !== id.generation || BigInt(id.generation) === MAX_GENERATION) return false;
      const record: UsageJournalRecord = {...id, state: 'acquiring', intent: frozen, retryAt: intent.acquireBy, retries: 0};
      this.storage.sql.exec("UPDATE usage_caller_slots_v2 SET state = 'occupied', record = ? WHERE slot = ?",
        JSON.stringify(record), id.slot);
      return true;
    });
  }

  /** Persist complete cancellation routing/payload BEFORE remote begin; never replace its tuple. */
  attach(id: UsageCandidate, target: UsageCleanupTarget, now: number): boolean {
    bounded(target.deployment, 128); bounded(target.owner, 128); bounded(target.key, 512); bounded(target.ticket, 4096);
    const frozen = {deployment: target.deployment, owner: target.owner, key: target.key, ticket: target.ticket};
    return this.storage.transactionSync(() => {
      const record = this.live(id, now);
      if (!record || record.state !== 'acquiring') return false;
      if (record.remote) return JSON.stringify(record.remote) === JSON.stringify(frozen);
      record.remote = frozen; this.save(record); return true;
    });
  }

  private live(id: UsageCandidate, now: number): UsageJournalRecord | undefined {
    timestamp(now);
    const r = this.read(id);
    if (!r || r.state === 'cleaning' || now >= this.deadline(r)) return undefined;
    return r;
  }

  /** Record a validated pending reply, with original expiry. This exposes no usable root. */
  pending(id: UsageCandidate, expiresAt: number, now: number): boolean {
    timestamp(expiresAt);
    return this.storage.transactionSync(() => {
      const r = this.live(id, now);
      if (!r?.remote || expiresAt <= now ||
          expiresAt > r.intent.issuedAt + 900000 || (r.expiresAt !== undefined && r.expiresAt !== expiresAt)) return false;
      if (r.state === 'pending') return true;
      if (r.state !== 'acquiring') return false;
      r.state = 'pending'; r.expiresAt = expiresAt; this.save(r); return true;
    });
  }

  /** Persist adoption intent before sending activation; owner/Stop/access checks remain adapter work. */
  adopting(id: UsageCandidate, now: number): boolean {
    return this.transition(id, 'pending', 'adopting', now);
  }
  /** Record validated activation acknowledgement; caller still must recheck identity/access/deadline. */
  adopted(id: UsageCandidate, now: number): boolean {
    return this.transition(id, 'adopting', 'adopted', now);
  }
  private transition(id: UsageCandidate, from: UsageJournalRecord['state'], to: UsageJournalRecord['state'], now: number) {
    return this.storage.transactionSync(() => {
      const r = this.live(id, now);
      // Duplicate activation cannot acknowledge adoption after the original acquisition window.
      if (!r || now >= r.intent.acquireBy) return false;
      if (r.state === to) return true;
      if (r.state !== from) return false;
      r.state = to; this.save(r); return true;
    });
  }

  /**
   * Close locally immediately, including cancel-before-claim. Retain the original remote tuple
   * in the SAME row until acknowledged. No role, grant, new slot or current identity is needed.
   */
  close(id: UsageCandidate, now: number): boolean {
    candidate(id); timestamp(now);
    return this.storage.transactionSync(() => {
      const row = this.rows()[id.slot];
      const r = this.read(id);
      // The row fence may already be ahead of the retained cleanup record.
      // Never treat that advanced fence as an empty slot: only acknowledged
      // cleanup may remove the original routing/ticket obligation.
      if (row.state === 'cleaning') {
        return r?.state === 'cleaning' || BigInt(row.generation) > BigInt(id.generation);
      }
      if (BigInt(row.generation) > BigInt(id.generation) || row.state === 'sealed') return true;
      if (row.generation !== id.generation) return false;
      if (r?.remote) {
        r.state = 'cleaning'; r.retryAt = now; r.retries = 0;
        this.storage.sql.exec(`UPDATE usage_caller_slots_v2 SET
          generation = CASE WHEN generation < 9223372036854775807 THEN generation + 1 ELSE generation END,
          state = 'cleaning', record = ? WHERE slot = ?`, JSON.stringify(r), id.slot);
      } else {
        this.storage.sql.exec(`UPDATE usage_caller_slots_v2 SET
          state = CASE WHEN generation >= 9223372036854775806 THEN 'sealed' ELSE 'free' END,
          generation = CASE WHEN generation < 9223372036854775807 THEN generation + 1 ELSE generation END,
          record = NULL WHERE slot = ?`, id.slot);
      }
      return true;
    });
  }

  /** Synchronous expiry checks plus conservative wake cancellation of every non-adopted invocation. */
  recover(now: number, waking = false): void {
    timestamp(now);
    this.storage.transactionSync(() => {
      for (const r of this.records()) {
        if (r.state === 'cleaning') continue;
        if (now >= this.deadline(r) ||
            (waking && r.state !== 'adopted')) this.close(r, now);
      }
    });
  }

  private deadline(r: UsageJournalRecord): number {
    return r.state === 'adopted' ? r.expiresAt! : Math.min(r.intent.acquireBy, r.expiresAt ?? Infinity);
  }

  /** Earliest durable deadline; owning DO merges this with existing delivery/agent alarms. */
  nextAlarm(): number | undefined {
    const due = this.records().map(r => r.state === 'cleaning' ? r.retryAt : this.deadline(r));
    return due.length ? Math.min(...due) : undefined;
  }

  /** Publish storage/alarm before any remote side effect. Never postpone another subsystem's alarm. */
  async arm(): Promise<void> {
    await this.schedule(async () => {
      const due = this.nextAlarm();
      if (due === undefined) return;
      const existing = await this.storage.getAlarm();
      if (existing === null || due < existing) await this.storage.setAlarm(due);
    });
  }

  /**
   * One bounded cleanup batch. Callback MUST validate an exact remote terminal proof, not merely
   * transport success. It gets only original stored routing. A timeout/lost ack retains the row.
   * Owning DO serializes drain calls and rechecks its shared alarm after this returns.
   */
  async drain(cancel: (target: UsageCleanupTarget) => Promise<boolean>, now = Date.now()): Promise<void> {
    this.recover(now);
    const due = this.records().filter(r => r.state === 'cleaning' && r.retryAt <= now);
    // Backoff ownership is durable BEFORE any await; an eviction here still has a wake deadline.
    this.storage.transactionSync(() => {
      for (const r of due) {
        r.retries = Math.min(8, r.retries + 1);
        r.retryAt = now + Math.min(60000, 250 * 2 ** r.retries);
        this.save(r);
      }
    });
    await this.arm();
    await Promise.all(due.map(async r => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let ack = false;
      try {
        ack = await Promise.race([Promise.resolve().then(() => cancel(r.remote!)),
          new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 1000); })]);
      } catch { /* Durable obligation remains; no errors or attempt history are appended. */ }
      finally { clearTimeout(timer); }
      if (ack !== true) return;
      this.storage.transactionSync(() => {
        const current = this.read(r);
        if (current?.state !== 'cleaning' || JSON.stringify(current.remote) !== JSON.stringify(r.remote)) return;
        this.storage.sql.exec(`UPDATE usage_caller_slots_v2 SET record = NULL,
          state = CASE WHEN generation = 9223372036854775807 THEN 'sealed' ELSE 'free' END WHERE slot = ?`, r.slot);
      });
    }));
    await this.arm();
  }
}
