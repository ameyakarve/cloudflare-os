import {DurableObject} from 'cloudflare:workers';

/** Test-only native transport barrier. No identity, quota or successful authority methods. */
export class NativeChainBarrier extends DurableObject {
  #release!: () => void;
  #entered!: () => void;
  #revoked!: () => void;
  #held = new Promise<void>(resolve => { this.#release = resolve; });
  #seen = new Promise<void>(resolve => { this.#entered = resolve; });
  #stopped = new Promise<void>(resolve => { this.#revoked = resolve; });
  async hold() { this.#entered(); await this.#held; }
  async entered() { await this.#seen; }
  async markRevoked() { this.#revoked(); }
  async revoked() { await this.#stopped; }
  async release() { this.#release(); }
}
