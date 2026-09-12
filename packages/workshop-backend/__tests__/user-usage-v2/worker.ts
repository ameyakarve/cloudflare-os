export {UserDurableObject} from '../../src/user.js';
export {AdminSettings} from '../../src/admin-settings.js';
import {DurableObject, WorkerEntrypoint} from 'cloudflare:workers';

/** Synthetic role authority only; no accounting decisions live here. */
export class AccessState extends DurableObject {
  set(value: {denied?: boolean; delay?: number; ttl?: number}) { this.ctx.storage.kv.put('role', value); }
  async check() {
    const value = this.ctx.storage.kv.get<{denied?: boolean; delay?: number; ttl?: number}>('role');
    if (value?.delay) await new Promise(resolve => setTimeout(resolve, value.delay));
    return value?.denied ? {allowed: false as const, reason: 'denied' as const}
      : {allowed: true as const, validUntil: Date.now() + (value?.ttl ?? 60000)};
  }
}
/** Existing deployment role interface, behind a real private native binding. */
export class BoundaryAccess extends WorkerEntrypoint<{ACCESS_STATE: DurableObjectNamespace<AccessState>}> {
  checkAccess(key: string) { return this.env.ACCESS_STATE.getByName(key).check(); }
}
export default {fetch: () => new Response('Offline User boundary fixture')};
