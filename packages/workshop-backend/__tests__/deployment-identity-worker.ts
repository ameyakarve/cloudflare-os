export { default } from '../src/server.js';
export * from '../src/server.js';
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import type { DeploymentIdentity } from '@gadgets/workshop-shared/gatekeeper';

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
