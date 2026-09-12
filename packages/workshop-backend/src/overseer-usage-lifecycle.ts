import { UsageAcquisitionJournal, type UsageCandidate, type UsageCallerIntent, type UsageCleanupTarget } from './usage-acquisition-journal.js';

/** Internal Overseer ownership only. No acquisition, public RPC, or dispatch authority. */
export class OverseerUsageLifecycle {
  readonly journal: UsageAcquisitionJournal;
  private draining?: Promise<void>;

  constructor(private readonly storage: DurableObjectStorage,
      schedule: (operation: () => Promise<void>) => Promise<void>,
      private readonly changed: () => void,
      private readonly cancel: (target: UsageCleanupTarget) => Promise<boolean>) {
    this.journal = new UsageAcquisitionJournal(storage, schedule);
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS overseer_usage_owner_v2 (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1), owner TEXT, incarnation TEXT NOT NULL)`);
    storage.sql.exec('INSERT OR IGNORE INTO overseer_usage_owner_v2 VALUES (1, NULL, ?)', crypto.randomUUID());
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS overseer_usage_execution_v2 (
      slot INTEGER PRIMARY KEY CHECK(slot >= 0 AND slot < 20), generation TEXT NOT NULL,
      chat INTEGER, execution TEXT)`);
  }

  get identity(): {owner: string | null; incarnation: string} {
    return this.storage.sql.exec<{owner: string | null; incarnation: string}>(
      'SELECT owner, incarnation FROM overseer_usage_owner_v2 WHERE singleton = 1').one();
  }

  setOwner(owner: string | undefined): void {
    if (owner !== undefined && (!owner || owner.length > 128 || owner.includes('\0'))) {
      throw new TypeError('Invalid Overseer usage owner');
    }
    if (this.identity.owner === (owner ?? null)) return;
    this.storage.transactionSync(() => {
      for (const r of this.journal.records()) this.journal.close(r, Date.now());
      this.storage.sql.exec('UPDATE overseer_usage_owner_v2 SET owner = ?, incarnation = ? WHERE singleton = 1',
        owner ?? null, crypto.randomUUID());
    });
    this.changed();
  }

  /** Acquisition claims here, before awaits, with its creation-owned execution. */
  claim(id: UsageCandidate, intent: UsageCallerIntent, execution?: {chat: number; id: string}): boolean {
    if (execution && (!Number.isSafeInteger(execution.chat) || execution.chat < 0 ||
        !execution.id || execution.id.length > 128 || execution.id.includes('\0'))) return false;
    const identity = this.identity;
    if (intent.owner !== identity.owner || intent.incarnation !== identity.incarnation) return false;
    return this.storage.transactionSync(() => {
      if (!this.journal.claim(id, intent, Date.now())) return false;
      const old = this.storage.sql.exec<{generation: string; chat: number | null; execution: string | null}>(
        'SELECT generation, chat, execution FROM overseer_usage_execution_v2 WHERE slot = ?', id.slot).toArray()[0];
      if (old?.generation === id.generation) {
        return old.chat === (execution?.chat ?? null) && old.execution === (execution?.id ?? null);
      }
      this.storage.sql.exec('INSERT OR REPLACE INTO overseer_usage_execution_v2 VALUES (?, ?, ?, ?)',
        id.slot, id.generation, execution?.chat ?? null, execution?.id ?? null);
      return true;
    });
  }

  /** Exact persisted execution link; slot reuse or a same-chat replacement never inherits a lease. */
  linked(id: UsageCandidate, execution: {chat: number; id: string}): boolean {
    const link = this.storage.sql.exec<{generation: string; chat: number | null; execution: string | null}>(
      'SELECT generation, chat, execution FROM overseer_usage_execution_v2 WHERE slot = ?', id.slot).toArray()[0];
    return link?.generation === id.generation && link.chat === execution.chat && link.execution === execution.id;
  }

  closeExecution(chat: number, keepExecution?: string): void {
    for (const link of this.storage.sql.exec<{slot: number; generation: string; execution: string | null}>(
      'SELECT slot, generation, execution FROM overseer_usage_execution_v2 WHERE chat = ?', chat)) {
      if (keepExecution !== undefined && link.execution === keepExecution) continue;
      this.journal.close(link, Date.now());
    }
    this.changed();
  }

  /** Only adopted, still-current agent executions may survive wake; controls never resume. */
  wake(current: (chat: number, execution: string) => boolean): void {
    this.journal.recover(Date.now(), true);
    for (const r of this.journal.records()) {
      const link = this.storage.sql.exec<{generation: string; chat: number | null; execution: string | null}>(
        'SELECT generation, chat, execution FROM overseer_usage_execution_v2 WHERE slot = ?', r.slot).toArray()[0];
      if (r.intent.owner !== this.identity.owner || r.intent.incarnation !== this.identity.incarnation ||
          !link || link.generation !== r.generation || link.chat === null || !link.execution ||
          !current(link.chat, link.execution)) this.journal.close(r, Date.now());
    }
    this.changed();
  }

  async drain(): Promise<void> {
    if (this.draining) return this.draining;
    this.draining = this.journal.drain(this.cancel).finally(() => {
      this.draining = undefined;
      this.changed();
    });
    return this.draining;
  }
}
