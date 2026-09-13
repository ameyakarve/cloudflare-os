import {env} from 'cloudflare:workers';
import {createExecutionContext, runInDurableObject} from 'cloudflare:test';
import {PublicApiImpl, type NativePostContextRoot} from '../../src/server.js';
import type {AuthenticatedApi} from '@gadgets/workshop-shared/api';
import type {OverseerDurableObject} from '../../src/overseer.js';
import type {UserDurableObject} from '../../src/user.js';
import type {NativeChainBarrier} from './barrier.js';
import type {NativePostCanonicalApi} from '@gadgets/workshop-shared/os-native-post.generated';

declare global { namespace Cloudflare { interface Env {
  TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>;
  TEST_USER_V2: DurableObjectNamespace<UserDurableObject>;
  CANONICAL_INSPECT: Fetcher;
  TEST_NATIVE_BARRIER: DurableObjectNamespace<NativeChainBarrier>;
} } }
export const good = <T>(r: {ok: true; value: T} | {ok: false; reason: string}) => { if (!r.ok) throw Error(r.reason); return r.value; };
export async function inspect(key: string) {
  return (await env.CANONICAL_INSPECT.fetch(`https://fixture.test/?key=${encodeURIComponent(key)}`)).json<{
    runs: {id: string; finished: number}[]; receipts: {id: string; run_id: string; usage: string}[]; daily: {usage: string}[];
  }>();
}
export async function native(key: string) {
  return (await env.CANONICAL_INSPECT.fetch(`https://fixture.test/?native&key=${encodeURIComponent(key)}`)).json<Record<string, Record<string, unknown>[]>>();
}
export async function fixture() {
  const key = `Native.${crypto.randomUUID()}@example.test`;
  const overseer = env.TEST_OVERSEER.getByName(key);
  const result = await runInDurableObject(overseer, async (instance, ctx) => {
    const abort = new AbortController();
    const context = Object.assign(createExecutionContext(), {exports: {
      ...ctx.exports, UserDurableObject: env.TEST_USER_V2, OverseerDurableObject: env.TEST_OVERSEER,
    }, waitUntil: (promise: Promise<unknown>) => ctx.waitUntil(promise)});
    const config = {...instance['env'], MILESVAULT_AUTH: 'true', NATIVE_POST_HUMAN_V2: 'true'};
    const publicRoot = new PublicApiImpl(context, config, reason => abort.abort(reason),
      {email: key.toLowerCase(), externalIdentityKey: key}, abort.signal);
    const root = await publicRoot.authenticateFromCfAccess() as AuthenticatedApi & NativePostContextRoot;
    const user = env.TEST_USER_V2.get(env.TEST_USER_V2.idFromString(await root.getRecoveryPrincipal()));
    await user.newGadget(overseer.id.toString(), 'Synthetic registered workspace');
    const impl = instance['impl'];
    impl.users = env.TEST_USER_V2;
    impl.ownerId = user.id.toString(); impl.storage.ownerId.put(impl.ownerId);
    impl.env.NATIVE_POST_HUMAN_V2 = 'true';
    // Initial registration only. Actual canonical resource factory and readiness/owner checks.
    impl.storage.gadgets.put({type: 'gadget', id: 3, title: 'Synthetic input', created: new Date(0),
      bindingName: 'LEDGER', bindings: {}, output: {id: 'ledger', noun: 'Ledger', plural: 'Ledgers', icon: 'table'}});
    await instance.configureMilesVaultLedgerOutput(user.id.toString(), key);
    return {key, root, publicRoot, userId: user.id.toString(), overseer, abort, config,
      candidate: {workspaceId: overseer.id.toString(), workpieceId: '3'}};
  });
  const input = await (await env.CANONICAL_INSPECT.fetch(`https://fixture.test/?native&key=${encodeURIComponent(key)}`, {method: 'POST'})).json<Parameters<NativePostCanonicalApi['prepareSelection']>[0]>();
  return {...result, input, user: env.TEST_USER_V2.get(env.TEST_USER_V2.idFromString(result.userId))};
}
