import {DurableObject} from 'cloudflare:workers';
import {UsageAcquisitionJournal} from '../src/usage-acquisition-journal';

/** SQLite journal fixture only; deliberately not advertised as paired User/M acceptance. */
export class UsageJournalTestObject extends DurableObject {
  async snapshot() { return new UsageAcquisitionJournal(this.ctx.storage).records(); }
  async alarm() { /* Test explicitly drives recovery/drain; no remote service is installed. */ }
}
export default {fetch() { return new Response('Not a public API', {status: 404}); }};
