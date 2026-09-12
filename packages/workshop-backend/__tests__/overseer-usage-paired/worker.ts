// Reuse the real User/M boundary role fixture and the lifecycle fixture's actual Overseer.
export {UserDurableObject, AdminSettings, AccessState, BoundaryAccess} from '../user-usage-v2/worker.js';
export {default} from '../user-usage-v2/worker.js';
import {OverseerDurableObject} from '../../src/overseer.js';
export {OverseerDurableObject};

/** Test-only native entrypoint; delegates to the actual control site without a test callback RPC. */
export class PairedOverseerProbe extends OverseerDurableObject {
  acquireControl() { return this['impl'].getUsageBudget({from: 'hook'}); }
  async acquireAgent() {
    return (await this['impl'].newUsageScope(undefined, {chat: 7, id: 'original-execution'}))?.run;
  }
}
