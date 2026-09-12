import {RpcTarget} from 'cloudflare:workers';
import type {OsUsagePolicyApi, OsAcquisitionTicketV2, OsAcquisitionResultV2} from '@gadgets/workshop-shared/os-usage.generated';
import type {DeploymentUsage, DeploymentUsageRun, UsageGrant} from '@gadgets/workshop-shared/deployment-usage';
import type {DeploymentAccessGrant} from '@gadgets/workshop-shared/deployment-access';
import {DeploymentUsageError} from './deployment-usage.js';
import {UsageAcquisitionJournal, type UsageCleanupTarget} from './usage-acquisition-journal.js';
import {UsageAcquisitionReceiver, type UsageReceiverTicket} from './usage-acquisition-receiver.js';

type Identity = {owner: string; key: string; incarnation: string; deployment?: string};
type Route = Identity & {ticket: OsAcquisitionTicketV2; deployment: string};
type Binding = {deployment: string; policy: Service<OsUsagePolicyApi>};
const routeKey = (slot: number) => `usage-route-v2:${slot}`;
const sameIdentity = (a: Identity, b: Identity | undefined) => !!b && a.owner === b.owner && a.key === b.key && a.incarnation === b.incarnation && a.deployment === b.deployment;

/** User-owned V2 coordinator. Only the private User DO entrypoints create/use this object. */
export class UserUsageV2 {
  readonly journal: UsageAcquisitionJournal;
  readonly receiver: UsageAcquisitionReceiver;
  private draining?: Promise<void>;
  constructor(private ctx: DurableObjectState,
      private identity: () => Identity | undefined,
      private binding: (deployment?: string) => Binding | undefined,
      private access: (key: string) => Promise<DeploymentAccessGrant | undefined>) {
    this.journal = new UsageAcquisitionJournal(ctx.storage, operation => ctx.blockConcurrencyWhile(operation));
    this.receiver = new UsageAcquisitionReceiver(ctx.storage, this.journal);
  }

  /** Wake never completes an interrupted handoff. Existing adopted runs remain lookup-only. */
  async wake() {
    this.journal.recover(Date.now(), true);
    await this.drain();
  }
  /** One shared-alarm batch, preserving any earlier alarm owned by another User subsystem. */
  async alarm() { this.journal.recover(Date.now()); await this.drain(); }
  private arm() { return this.journal.arm(); }
  private policy(route: Route) {
    const binding = this.binding(route.deployment);
    if (!binding || binding.deployment !== route.deployment) throw new DeploymentUsageError();
    return binding.policy;
  }
  private route(ticket: UsageReceiverTicket): Route {
    const route = this.ctx.storage.kv.get<Route>(routeKey(ticket.slot));
    const record = this.journal.read(ticket);
    if (!route || !record?.remote || record.remote.ticket !== JSON.stringify(route.ticket) ||
        record.remote.key !== route.key || record.remote.owner !== route.owner || record.remote.deployment !== route.deployment) {
      throw new DeploymentUsageError();
    }
    return route;
  }
  private check(ticket: UsageReceiverTicket, identity: Identity, state?: string, access?: DeploymentAccessGrant) {
    if (!sameIdentity(identity, this.identity()) || !this.receiver.matches(ticket, Date.now()) ||
        (state && this.receiver.status(ticket) !== state) || (access && access.validUntil <= Date.now())) {
      throw new DeploymentUsageError('expired_run');
    }
  }
  private async bounded<T>(operation: PromiseLike<T>, deadline: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (deadline <= Date.now()) throw new DeploymentUsageError('expired_run');
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DeploymentUsageError()), deadline - Date.now());
      })]);
    } finally { clearTimeout(timer); }
  }
  private async authorized(ticket: UsageReceiverTicket, identity: Identity, state: string, deadline: number) {
    this.check(ticket, identity, state);
    const grant = await this.bounded(this.access(identity.key), deadline);
    this.check(ticket, identity, state, grant);
    return grant;
  }
  private async close(ticket: UsageReceiverTicket) {
    this.receiver.cancel(ticket, Date.now()); // local fence first; no role lookup
    await this.arm();
    await this.drain();
  }
  private async drain() {
    if (this.draining) return this.draining;
    this.draining = this.journal.drain(async (target: UsageCleanupTarget) => {
      // Resolve ONLY the retained named route, never the current route pointer/identity or a renewed role.
      const record = this.journal.records().find(r => r.remote?.ticket === target.ticket && r.remote.deployment === target.deployment);
      if (!record) return false;
      const route = this.ctx.storage.kv.get<Route>(routeKey(record.slot));
      if (!route || route.key !== target.key || route.owner !== target.owner || route.deployment !== target.deployment ||
          JSON.stringify(route.ticket) !== target.ticket) return false;
      const result = await this.policy(route).cancelAcquisitionV2(route.key, route.ticket);
      return result?.protocol === 2 && (result.state === 'terminal' || result.state === 'conflict');
    }).finally(() => { this.draining = undefined; });
    return this.draining;
  }
  /** Snapshot is private recovery data, not permission to begin after its fixed deadline. */
  async read() { await this.drain(); return this.receiver.read(Date.now()); }
  /** Cancel-before-begin and losing-ticket cancellation share the receiver's exact fence. */
  async cancel(ticket: UsageReceiverTicket) {
    const status = this.receiver.cancel(ticket, Date.now());
    await this.arm(); await this.drain(); return status;
  }
  /** Status never constructs a root or sends begin/activation. */
  async status(ticket: UsageReceiverTicket) {
    this.journal.recover(Date.now()); await this.arm(); return this.receiver.status(ticket);
  }
  /** Claim/arm precede access; full retained native route and M ticket precede remote begin. */
  async begin(input: UsageReceiverTicket) {
    const ticket = {...input};
    const status = this.receiver.begin(ticket, Date.now());
    if (status !== 'acquiring') throw new DeploymentUsageError();
    const identity = this.identity();
    try {
      if (!identity) throw new DeploymentUsageError();
      await this.arm(); this.check(ticket, identity, 'acquiring');
      const access = await this.authorized(ticket, identity, 'acquiring', ticket.acquireBy);
      let route = this.ctx.storage.kv.get<Route>(routeKey(ticket.slot));
      if (!this.journal.read(ticket)?.remote) {
        const binding = this.binding();
        if (!binding) throw new DeploymentUsageError();
        const {policy, deployment} = binding;
        const snapshot = await this.bounded(policy.readAcquisitionSlotsV2(identity.key), ticket.acquireBy);
        this.check(ticket, identity, 'acquiring', access);
        if (snapshot?.protocol !== 2 || snapshot.slotCount !== 20 || !/^[a-f0-9-]{36}$/.test(snapshot.namespace) ||
            snapshot.features?.join() !== 'pending-activation,durable-fence,fixed-expiry' || snapshot.slots?.length !== 20 ||
            snapshot.slots.some((s, i) => s.slot !== i || !/^(0|[1-9][0-9]{0,18})$/.test(s.generation) ||
              BigInt(s.generation) > 9223372036854775807n || !['free','pending','active','sealed'].includes(s.state))) throw new DeploymentUsageError();
        const slot = snapshot.slots.find(s => s.state === 'free' && BigInt(s.generation) < 9223372036854775807n);
        if (!slot) throw new DeploymentUsageError();
        const remote: OsAcquisitionTicketV2 = {protocol: 2, namespace: snapshot.namespace, slot: slot.slot,
          generation: slot.generation, ownerId: this.ctx.id.toString(), operationId: ticket.operation,
          payloadHash: ticket.payloadHash, runId: crypto.randomUUID(), issuedAt: ticket.issuedAt, acquireBy: ticket.acquireBy};
        route = {...identity, ticket: remote, deployment};
        this.ctx.storage.transactionSync(() => {
          if (!this.journal.attach(ticket, {deployment: route!.deployment, owner: identity.owner, key: identity.key,
            ticket: JSON.stringify(remote)}, Date.now())) throw new DeploymentUsageError();
          // One slot retains the original named deployment route. Never use the current-route pointer for cleanup.
          this.ctx.storage.kv.put(routeKey(ticket.slot), route!);
        });
      }
      route = this.route(ticket);
      await this.arm(); this.check(ticket, identity, 'acquiring', access);
      const result = await this.bounded((async () => await this.policy(route).beginAcquisitionV2(route.key, route.ticket))(), ticket.acquireBy);
      this.check(ticket, identity, 'acquiring', access);
      this.validate(result, route, 'pending');
      if (!('expiresAt' in result) || !this.journal.pending(ticket, result.expiresAt, Date.now())) throw new DeploymentUsageError();
      await this.arm(); this.check(ticket, identity, 'pending', access);
      return {protocol: 2 as const, state: 'pending' as const, runId: route.ticket.runId, expiresAt: result.expiresAt};
    } catch (error) { await this.close(ticket); throw error; }
  }
  private validate(result: OsAcquisitionResultV2, route: Route, state: 'pending' | 'active', expiry?: number) {
    if (result?.protocol === 2 && result.state === 'denied') throw new DeploymentUsageError(result.reason);
    if (!result || result.protocol !== 2 || result.state !== state || !('runId' in result) ||
        result.runId !== route.ticket.runId || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now() ||
        result.expiresAt > route.ticket.issuedAt + 900000 || (expiry !== undefined && expiry !== result.expiresAt)) throw new DeploymentUsageError();
  }
  /** Persist adoption intent before M activation; expose authority only after durable final adoption. */
  async adopt(input: UsageReceiverTicket) {
    const ticket = {...input};
    try {
      const route = this.route(ticket);
      const access = await this.authorized(ticket, route, 'pending', ticket.acquireBy);
      if (!this.journal.adopting(ticket, Date.now())) throw new DeploymentUsageError();
      await this.arm(); this.check(ticket, route, 'adopting', access);
      const result = await this.bounded((async () => await this.policy(route).activateAcquisitionV2(route.key, route.ticket))(), ticket.acquireBy);
      this.check(ticket, route, 'adopting', access);
      this.validate(result, route, 'active', this.journal.read(ticket)?.expiresAt);
      if (!this.journal.adopted(ticket, Date.now())) throw new DeploymentUsageError();
      await this.arm(); this.check(ticket, route, 'adopted', access);
      if (Date.now() >= ticket.acquireBy) throw new DeploymentUsageError('expired_run');
      return new DurableUserUsageRun(this, ticket, route);
    } catch (error) { await this.close(ticket); throw error; }
  }
  /** Prevent a legacy-shaped User resume from bypassing local V2 adoption/fencing. */
  ownsRun(runId: string) {
    return this.journal.records().some(record => record.remote &&
      this.ctx.storage.kv.get<Route>(routeKey(record.slot))?.ticket.runId === runId);
  }
  /** Resume only a previously adopted exact run; never calls begin or activation. */
  async resume(input: UsageReceiverTicket, expected: UsageGrant) {
    const ticket = {...input};
    try {
      const route = this.route(ticket);
      const deadline = Math.min(this.journal.read(ticket)?.expiresAt ?? 0, Date.now() + 5000);
      const access = await this.authorized(ticket, route, 'adopted', deadline);
      const grant = await this.grant(ticket);
      this.check(ticket, route, 'adopted', access);
      if (grant.runId !== expected.runId || grant.expiresAt !== expected.expiresAt) throw new DeploymentUsageError();
      return new DurableUserUsageRun(this, ticket, route);
    } catch (error) { await this.close(ticket); throw error; }
  }
  /** Every grant lookup consults durable adoption, current identity/access and actual M linkage. */
  async grant(ticket: UsageReceiverTicket): Promise<UsageGrant> {
    try {
      const route = this.route(ticket);
      const expiry = this.journal.read(ticket)?.expiresAt ?? 0;
      const deadline = Math.min(expiry, Date.now() + 5000);
      const access = await this.authorized(ticket, route, 'adopted', deadline);
      const result = await this.bounded((async () => await this.policy(route).getRunGrant(route.key, route.ticket.runId))(), deadline);
      this.check(ticket, route, 'adopted', access);
      // Status is recovery data, not authority. Canonical getRunGrant checks active accounting linkage.
      if (result?.allowed !== true || result.runId !== route.ticket.runId || result.expiresAt !== expiry) throw new DeploymentUsageError();
      return {allowed: true, runId: result.runId, expiresAt: result.expiresAt};
    } catch (error) { await this.close(ticket); throw error; }
  }
  /** Receipt acknowledgement after cancellation is never returned as fresh dispatch permission. */
  async reserve(ticket: UsageReceiverTicket, usage: DeploymentUsage, receipts: Set<string>) {
    try {
      const grant = await this.grant(ticket);
      const route = this.route(ticket); this.check(ticket, route, 'adopted');
      const deadline = Math.min(grant.expiresAt, Date.now() + 5000);
      const access = await this.authorized(ticket, route, 'adopted', deadline);
      const id = crypto.randomUUID();
      const result = await this.bounded((async () => await this.policy(route).reserve(route.key, grant.runId, id, usage))(), deadline);
      this.check(ticket, route, 'adopted', access);
      if (result?.allowed !== true) throw new DeploymentUsageError(result?.allowed === false ? result.reason : undefined,
        result?.allowed === false ? result.resource : undefined);
      receipts.add(id);
      return id;
    } catch (error) { await this.close(ticket); throw error; }
  }
  /** Finish records durable close first and retries cleanup even on repeated calls. */
  finish(ticket: UsageReceiverTicket) { return this.close(ticket); }
  /** Settlement is close-only accounting against the original capability, never current routing. */
  settle(route: Route, id: string, tokens: number) {
    return this.bounded(this.policy(route).settleTokens(route.key, id, tokens), Date.now() + 5000);
  }
}

/** Actual User V2 root: no cached grant/finished flag can bypass durable fences. */
class DurableUserUsageRun extends RpcTarget implements DeploymentUsageRun {
  private receipts = new Set<string>();
  constructor(private owner: UserUsageV2, private ticket: UsageReceiverTicket, private route: Route) { super(); }
  getGrant() { return this.owner.grant(this.ticket); }
  reserve(usage: DeploymentUsage) { return this.owner.reserve(this.ticket, usage, this.receipts); }
  settleTokens(id: string, tokens: number) {
    if (!this.receipts.has(id)) throw new DeploymentUsageError();
    return this.owner.settle(this.route, id, tokens);
  }
  finish() { return this.owner.finish(this.ticket); }
}
