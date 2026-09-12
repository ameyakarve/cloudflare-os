import {RpcTarget, RpcStub} from 'cloudflare:workers';
import type {DeploymentUsage, DeploymentUsageRun, UsageGrant} from '@gadgets/workshop-shared/deployment-usage';
import type {DeploymentAccessGrant} from '@gadgets/workshop-shared/deployment-access';
import type {UserDurableObject} from './user.js';
import type {UsageReceiverTicket} from './usage-acquisition-receiver.js';
import type {UsageJournalRecord} from './usage-acquisition-journal.js';
import {OverseerUsageLifecycle} from './overseer-usage-lifecycle.js';
import {DeploymentUsageError} from './deployment-usage.js';

/** Creation-owned execution; the predicate must compare persisted execution and Stop, not chat alone. */
export type UsageExecution = {chat: number; id: string};
type Owned = {record: UsageJournalRecord; grant: UsageGrant; handoffDeadline?: number};

/** Private paired caller. The existing lifecycle owns cancellation transport and the shared alarm. */
export class OverseerUsageAcquisition {
  constructor(private storage: DurableObjectStorage, private life: OverseerUsageLifecycle,
      private users: DurableObjectNamespace<UserDurableObject>,
      private access: () => Promise<DeploymentAccessGrant | undefined>,
      private current: () => boolean, private execution?: UsageExecution) {
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS overseer_usage_grant_v2 (
      slot INTEGER PRIMARY KEY CHECK(slot >= 0 AND slot < 20), generation TEXT NOT NULL, grant_json TEXT NOT NULL CHECK(length(grant_json) <= 512))`);
  }
  private check(record: UsageJournalRecord, access?: DeploymentAccessGrant, acquiring = false) {
    this.life.journal.recover(Date.now());
    const live = this.life.journal.read(record);
    const identity = this.life.identity;
    if (!live || live.state === 'cleaning' || live.state !== record.state || live.expiresAt !== record.expiresAt ||
        JSON.stringify(live.intent) !== JSON.stringify(record.intent) ||
        JSON.stringify(live.remote) !== JSON.stringify(record.remote) || identity.owner !== record.intent.owner ||
        identity.incarnation !== record.intent.incarnation || !this.current() ||
        (this.execution && !this.life.linked(record, this.execution)) ||
        (access && access.validUntil <= Date.now()) ||
        (acquiring && Date.now() >= record.intent.acquireBy)) throw new DeploymentUsageError('expired_run');
  }
  private async wait<T>(promise: PromiseLike<T>, deadline: number, late?: (value: T) => void): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abandoned = false;
    const owned = Promise.resolve(promise).then(value => {
      if (abandoned) { late?.(value); throw new DeploymentUsageError(); }
      return value;
    });
    try {
      if (deadline <= Date.now()) throw new DeploymentUsageError('expired_run');
      return await Promise.race([owned, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DeploymentUsageError()), deadline - Date.now());
      })]);
    } finally { abandoned = true; clearTimeout(timer); void owned.catch(() => {}); }
  }
  private user(record: UsageJournalRecord) {
    return this.users.get(this.users.idFromString(record.intent.owner));
  }
  private async close(record: UsageJournalRecord) {
    this.life.journal.close(record, Date.now());
    await this.life.journal.arm();
    await this.life.drain();
  }
  private saved(record: UsageJournalRecord): UsageGrant | undefined {
    const row = this.storage.sql.exec<{grant_json: string}>(
      'SELECT grant_json FROM overseer_usage_grant_v2 WHERE slot = ? AND generation = ?', record.slot, record.generation).toArray()[0];
    return row && JSON.parse(row.grant_json) as UsageGrant;
  }
  private validate(grant: UsageGrant, expected?: UsageGrant) {
    if (!grant || grant.allowed !== true || typeof grant.runId !== 'string' || !/^[a-f0-9-]{36}$/.test(grant.runId) ||
        !Number.isSafeInteger(grant.expiresAt) || grant.expiresAt <= Date.now() ||
        (expected && (grant.runId !== expected.runId || grant.expiresAt !== expected.expiresAt))) throw new DeploymentUsageError();
  }
  /** Original five seconds includes role and snapshot awaits. Never retries with a new candidate. */
  async open(existing?: UsageGrant): Promise<{run: RpcStub<DeploymentUsageRun>; check: () => void; publish: () => void}> {
    const issuedAt = Date.now();
    const identity = this.life.identity;
    if (!identity.owner || !this.current()) throw new DeploymentUsageError();
    let record: UsageJournalRecord;
    if (existing) {
      if (!this.execution) throw new DeploymentUsageError();
      const found = this.life.journal.records().find(r => r.state === 'adopted' &&
        this.life.linked(r, this.execution!) && this.saved(r)?.runId === existing.runId &&
        this.saved(r)?.expiresAt === existing.expiresAt);
      if (!found) throw new DeploymentUsageError('expired_run');
      record = found;
    } else {
      const id = this.life.journal.available()[0];
      if (!id || !this.life.claim(id, {owner: identity.owner, incarnation: identity.incarnation,
        operation: crypto.randomUUID(), issuedAt, acquireBy: issuedAt + 5000}, this.execution)) throw new DeploymentUsageError();
      record = this.life.journal.read(id)!;
    }
    let root: RpcStub<DeploymentUsageRun> | undefined;
    const deadline = existing ? Math.min(existing.expiresAt, issuedAt + 5000) : record.intent.acquireBy;
    try {
      this.check(record, undefined, !existing);
      await this.wait(this.life.journal.arm(), deadline); this.check(record, undefined, !existing);
      const access = await this.wait(this.access(), deadline); this.check(record, access, !existing);
      let ticket: UsageReceiverTicket;
      let expected: UsageGrant;
      if (existing) {
        ticket = JSON.parse(record.remote!.ticket) as UsageReceiverTicket;
        expected = existing;
        root = await this.wait(this.user(record).resumeDeploymentUsageRunV2(ticket, existing), deadline,
          value => value[Symbol.dispose]());
        this.check(record, access);
      } else {
        const snapshot = await this.wait(this.user(record).readUsageAcquisitionSlotsV2(), deadline);
        this.check(record, access, true);
        if (snapshot?.protocol !== 2 || typeof snapshot.namespace !== 'string' || !/^[a-f0-9-]{36}$/.test(snapshot.namespace) ||
            !Array.isArray(snapshot.slots) || snapshot.slots.length > 20 ||
            new Set(snapshot.slots.map(s => s.slot)).size !== snapshot.slots.length ||
            snapshot.slots.some(s => !Number.isInteger(s.slot) || s.slot < 0 || s.slot >= 20 ||
              typeof s.generation !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(s.generation) || BigInt(s.generation) >= 9223372036854775807n)) throw new DeploymentUsageError();
        const slot = snapshot.slots[0];
        if (!slot) throw new DeploymentUsageError();
        const digest = await this.wait(crypto.subtle.digest('SHA-256', new TextEncoder().encode(
          JSON.stringify({intent: record.intent, execution: this.execution}))), deadline);
        this.check(record, access, true);
        ticket = {slot: slot.slot, generation: slot.generation, ...record.intent, protocol: 2,
          namespace: snapshot.namespace, payloadHash: new Uint8Array(digest).toHex()};
        if (!this.life.journal.attach(record, {deployment: 'UserDurableObject', owner: record.intent.owner,
          key: record.intent.owner, ticket: JSON.stringify(ticket)}, Date.now())) throw new DeploymentUsageError();
        record = this.life.journal.read(record)!;
        await this.wait(this.life.journal.arm(), deadline); this.check(record, access, true);
        const pending = await this.wait(this.user(record).beginDeploymentUsageAcquisitionV2(ticket), deadline);
        this.check(record, access, true);
        if (pending?.protocol !== 2 || pending.state !== 'pending') throw new DeploymentUsageError();
        expected = {allowed: true, runId: pending.runId, expiresAt: pending.expiresAt};
        this.validate(expected);
        if (!this.life.journal.pending(record, expected.expiresAt, Date.now())) throw new DeploymentUsageError();
        this.storage.sql.exec('INSERT OR REPLACE INTO overseer_usage_grant_v2 VALUES (?, ?, ?)',
          record.slot, record.generation, JSON.stringify(expected));
        if (!this.life.journal.adopting(record, Date.now())) throw new DeploymentUsageError();
        record = this.life.journal.read(record)!;
        await this.wait(this.life.journal.arm(), deadline); this.check(record, access, true);
        root = await this.wait(this.user(record).adoptDeploymentUsageAcquisitionV2(ticket), deadline,
          value => value[Symbol.dispose]());
        this.check(record, access, true);
      }
      const grant = await this.wait(root.getGrant(), deadline); this.check(record, access, !existing);
      this.validate(grant, expected);
      if (!existing && !this.life.journal.adopted(record, Date.now())) throw new DeploymentUsageError();
      record = this.life.journal.read(record)!;
      await this.wait(this.life.journal.arm(), deadline); this.check(record, access, !existing);
      const owned: Owned = {record, grant, handoffDeadline: deadline};
      const run = new RpcStub(new OverseerUsageRoot(this, owned, root));
      root = undefined;
      const check = () => { this.check(record, access, !existing); if (Date.now() >= deadline) throw new DeploymentUsageError(); };
      return {run, check, publish: () => { check(); owned.handoffDeadline = undefined; }};
    } catch (error) {
      // Even a malformed root/disposal failure must not skip durable closure.
      try { root?.[Symbol.dispose](); } finally { await this.close(record); }
      throw error;
    }
  }
  /** New authority requires exact durable ownership before and after each role/root RPC. */
  async authority<T>(owned: Owned, operation: () => PromiseLike<T>): Promise<{value: T; access: DeploymentAccessGrant | undefined}> {
    try {
      this.output(owned, undefined);
      if (this.life.journal.read(owned.record)?.state !== 'adopted') throw new DeploymentUsageError();
      // UsageScope.open's extra grant lookup is still part of the original handoff, not a new window.
      const deadline = Math.min(owned.handoffDeadline ?? Infinity, owned.grant.expiresAt, Date.now() + 5000);
      const access = await this.wait(this.access(), deadline); this.output(owned, access);
      const result = await this.wait(operation(), deadline); this.output(owned, access);
      return {value: result, access};
    } catch (error) { await this.close(owned.record); throw error; }
  }
  /** Recheck at wrapper output, after the authority helper's own asynchronous return. */
  output(owned: Owned, access: DeploymentAccessGrant | undefined) {
    this.check(owned.record, access);
    if (owned.handoffDeadline !== undefined && Date.now() >= owned.handoffDeadline) throw new DeploymentUsageError('expired_run');
  }
  /** Receipt settlement retains original root routing and is allowed after local Stop/closure. */
  settlementOwner(owned: Owned) {
    const identity = this.life.identity;
    if (identity.owner !== owned.record.intent.owner || identity.incarnation !== owned.record.intent.incarnation) throw new DeploymentUsageError();
  }
  finish(owned: Owned) { return this.close(owned.record); }
}

class OverseerUsageRoot extends RpcTarget implements DeploymentUsageRun {
  private receipts = new Set<string>();
  constructor(private owner: OverseerUsageAcquisition, private owned: Owned, private root: RpcStub<DeploymentUsageRun>) { super(); }
  async getGrant() {
    try {
      const {value: grant, access} = await this.owner.authority(this.owned, () => this.root.getGrant());
      this.owner.output(this.owned, access);
      if (grant?.allowed !== true || grant.runId !== this.owned.grant.runId || grant.expiresAt !== this.owned.grant.expiresAt) {
        throw new DeploymentUsageError();
      }
      return grant;
    } catch (error) { await this.owner.finish(this.owned); throw error; }
  }
  async reserve(usage: DeploymentUsage) {
    try {
      const {value: id, access} = await this.owner.authority(this.owned, () => this.root.reserve(usage));
      this.owner.output(this.owned, access);
      if (typeof id !== 'string' || !id || id.length > 128) throw new DeploymentUsageError();
      this.receipts.add(id); return id;
    } catch (error) { await this.owner.finish(this.owned); throw error; }
  }
  async settleTokens(id: string, tokens: number) {
    this.owner.settlementOwner(this.owned);
    if (!this.receipts.has(id)) throw new DeploymentUsageError();
    await this.root.settleTokens(id, tokens);
    this.owner.settlementOwner(this.owned);
  }
  finish() { return this.owner.finish(this.owned); }
  [Symbol.dispose]() { this.root[Symbol.dispose](); }
}
