export { default } from '../src/server.js';
export * from '../src/server.js';
// Name the preview loopbacks explicitly so the test pool discovers their entrypoints.
export { GatekeeperLoopback, GadgetTailLoopback, CodeModeTailLoopback, LanguageModelGatekeeper, LedgerEditorGatekeeper, LedgerHoldingsGatekeeper } from '../src/server.js';
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import type { DeploymentIdentity } from '@gadgets/workshop-shared/gatekeeper';
import type { DeploymentAccessDecision } from '@gadgets/workshop-shared/deployment-access';

/** Native private-policy fixture with an exact-key guard and short test grants. */
export class IdentityTestAccessPolicy extends WorkerEntrypoint<Cloudflare.Env, {key: string; allowed: boolean}> {
  checkAccess(key: string): DeploymentAccessDecision {
    return key === this.ctx.props.key && this.ctx.props.allowed
      ? {allowed: true, validUntil: Date.now() + 100}
      : {allowed: false, reason: 'denied'};
  }
}

/** Persistable hook fixture: no external side effects. */
export class IdentityTestHook extends WorkerEntrypoint<Cloudflare.Env> {
  async enable() {}
  async disable() {}
  deliver() { return 'delivered'; }
}

/** Persistent fixture account: exercises real capability serialization in User DO storage. */
export class IdentityTestAccount extends WorkerEntrypoint<Cloudflare.Env, DeploymentIdentity> {
  describe() { return {displayName: 'Identity fixture', singleton: {tsType: 'IdentityFixture'}}; }
  getVerifier() { return this.ctx.exports.IdentityTestAccount({props: this.ctx.props}); }
  getStorageKey() { return this.ctx.props.storageKey; }
  getSingletonGatekeeperClass() { return this.ctx.exports.IdentityTestGatekeeper({props: this.ctx.props}); }
}

/** Fixture provider with the same private binding contract as a deployment account adapter. */
export class IdentityTestProvider extends WorkerEntrypoint<Cloudflare.Env> {
  createAccount(identity: DeploymentIdentity) {
    return this.ctx.exports.IdentityTestAccount({props: identity});
  }
}

/** A facet whose retained storage distinguishes a refresh from delete/recreate. */
export class IdentityTestGatekeeper extends DurableObject<Cloudflare.Env, DeploymentIdentity> {
  describe() { return {title: 'Identity fixture', url: 'https://identity.test/resource'}; }
  getStorageKey() { return this.ctx.props.storageKey; }
  putMarker(value: string) { this.ctx.storage.kv.put('marker', value); }
  getMarker() { return this.ctx.storage.kv.get<string>('marker'); }
}

/** Native private-quota fixture: verifies exact identity and explicit resume references. */
export class IdentityTestUsagePolicy extends WorkerEntrypoint<Cloudflare.Env, {key: string; expiresAt: number; resumeId?: string}> {
  async beginRun(key: string, runId: string) {
    return key === this.ctx.props.key ? {allowed: true as const, runId, expiresAt: this.ctx.props.expiresAt}
      : {allowed: false as const, reason: 'unavailable' as const};
  }
  async getRunGrant(key: string, runId: string) {
    return runId === this.ctx.props.resumeId ? this.beginRun(key, runId)
      : {allowed: false as const, reason: 'expired_run' as const};
  }
  async reserve(key: string) {
    return key === this.ctx.props.key ? {allowed: true as const} : {allowed: false as const, reason: 'unavailable' as const};
  }
  async settleTokens() {}
  async finishRun() {}
}
