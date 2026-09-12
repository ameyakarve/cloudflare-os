import { env, RpcStub } from 'cloudflare:workers';
import { createExecutionContext, runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { PublicApiImpl, type DeploymentInstallQuarantineRoot } from '../src/server.js';
import { INSTALL_QUARANTINE_KEY, stageDeploymentInstallQuarantine, type InstallQuarantineTicket } from '../src/deployment-install-quarantine.js';
import { deploymentInstallReleaseDigest, type DeploymentInstallRelease } from '@gadgets/workshop-shared/deployment-install';
import { encodeDeploymentInstallSnapshot, type DeploymentInstallSnapshot } from '@gadgets/workshop-shared/deployment-install';
import { OverseerDurableObject } from '../src/overseer.js';
import type { UserDurableObject } from '../src/user.js';

declare global { namespace Cloudflare { interface Env {
  TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>;
  TEST_USER: DurableObjectNamespace<UserDurableObject>;
} } }

// Only publisher bytes and access policy are synthetic. Allocation, git initialization, durable
// identity, cancellation and generic owner ingress use the actual classes and native DO storage.
const release: DeploymentInstallRelease = {
  releaseId: 'fixture.controls.v1', protocol: 1, blueprintId: 'fixture.controls.v1.blueprint',
  artifact: 'fixture/client.js', uiSha256: 'a'.repeat(64), factory: 'doctor-controls-v1',
  hostRuntime: 'private-install-v1', title: 'Install fixture controls', explanation: 'No scan or approval.',
  confirmLabel: 'Install new fixture controls',
};
const SLOT = 'deployment-install-attempt-v1';
type Slot = Omit<InstallQuarantineTicket, 'ownerId' | 'workspaceId'> & {workspaceId?: string; cancelled: boolean};

async function fixture(run: (f: {
  user: DurableObjectStub<UserDurableObject>;
  users: DurableObjectNamespace<UserDurableObject>;
  targets: DurableObjectNamespace<OverseerDurableObject>;
  stage: () => Promise<{workspaceId: string; workpieceId: number}>;
  cancel: () => Promise<void>;
  abort: AbortController;
  slot: () => Promise<Slot>;
  ticket: () => Promise<InstallQuarantineTicket>;
  publicConfirm: () => Promise<unknown>;
  probePublic: () => Promise<void>;
  pauseInit: () => {entered: Promise<void>; resume: () => void};
  fresh: () => Promise<{stage: () => Promise<{workspaceId: string; workpieceId: number}>}>;
}) => Promise<void>) {
  const anchor = env.TEST_OVERSEER.getByName(crypto.randomUUID());
  await runInDurableObject(anchor, async (instance, ctx) => {
    const digest = await deploymentInstallReleaseDigest(release);
    const snapshot: DeploymentInstallSnapshot = {releaseDigest: digest, blueprintId: release.blueprintId,
      title: 'Quarantined fixture', output: {id: 'doctor', title: 'Doctor'},
      files: {'README.md': 'Frozen fixture', 'client.js': 'throw new Error("must not run")',
        'server.js': 'throw new Error("must not run")'}};
    const hash = await crypto.subtle.digest('SHA-256', encodeDeploymentInstallSnapshot(snapshot));
    let pauseSnapshot: (() => Promise<void>) | undefined;
    const publisher = {getDeploymentInstallRelease: async () => release,
      getDeploymentInstallSnapshot: async () => {
        await pauseSnapshot?.();
        return {snapshot, sha256: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')};
      }};
    const realEnv = instance['env'];
    const prior = {app: realEnv.MILESVAULT_DOCTOR_APP, auth: realEnv.MILESVAULT_AUTH,
      policy: realEnv.DEPLOYMENT_ACCESS_POLICY};
    Object.assign(realEnv, {MILESVAULT_DOCTOR_APP: publisher, MILESVAULT_AUTH: 'true',
      DEPLOYMENT_ACCESS_POLICY: {checkAccess: async () => ({allowed: true, validUntil: Date.now() + 60_000})}});
    const abort = new AbortController();
    const context = Object.assign(createExecutionContext(), {exports: ctx.exports,
      waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p)});
    try {
      const principal = `Fixture-${crypto.randomUUID()}@example.com`;
      const root = new PublicApiImpl(context, realEnv, reason => abort.abort(reason),
        {email: principal.toLowerCase(), externalIdentityKey: principal}, abort.signal);
      const api = await root.authenticateFromCfAccess();
      const user = ctx.exports.UserDurableObject.get(ctx.exports.UserDurableObject.idFromString(await api.getRecoveryPrincipal()));
      const prepared = await api.prepareDeploymentInstall(release.releaseId);
      const slot = () => runInDurableObject(ctx.exports.UserDurableObject.get(user.id), (_u, c) => c.storage.kv.get<Slot>(SLOT)!);
      // The symbol is a local own property, not exposed on AuthenticatedApi or via RPC strings.
      const local = api as typeof api & DeploymentInstallQuarantineRoot;
      const stage = () => local[stageDeploymentInstallQuarantine](prepared.attempt);
      await run({user, users: ctx.exports.UserDurableObject, targets: ctx.exports.OverseerDurableObject, stage,
        cancel: () => api.cancelDeploymentInstall(prepared.attempt), abort, slot,
        ticket: async () => {
          const s = await slot();
          return {ownerId: user.id.toString(), session: s.session, attempt: s.attempt, digest: s.digest,
            principal: s.principal, incarnation: s.incarnation, expiresAt: s.expiresAt, workspaceId: s.workspaceId!};
        }, publicConfirm: () => api.confirmDeploymentInstall(prepared.attempt),
        probePublic: async () => {
          using rpc = new RpcStub(await root.authenticateFromCfAccess());
          for (const method of ['stageDeploymentInstallQuarantine', 'stageDeploymentInstallAttempt']) {
            await denied(() => Reflect.get(rpc, method)(prepared.attempt), 'does not implement');
          }
        },
        pauseInit: () => {
          const pause = {entered: false, resumed: false}; let count = 0;
          // Timers must be born in their own DO's I/O context, not a cross-DO JS promise.
          pauseSnapshot = async () => {
            if (++count !== 2) return;
            pause.entered = true;
            while (!pause.resumed) await new Promise(r => setTimeout(r, 1));
          };
          const entered = (async () => {while (!pause.entered) await new Promise(r => setTimeout(r, 1));})();
          return {entered, resume: () => {pause.resumed = true;}};
        },
        fresh: async () => {
          const next = await root.authenticateFromCfAccess();
          const p = await next.prepareDeploymentInstall(release.releaseId);
          const n = next as typeof next & DeploymentInstallQuarantineRoot;
          return {stage: () => n[stageDeploymentInstallQuarantine](p.attempt)};
        },
      });
    } finally {
      vi.restoreAllMocks();
      Object.assign(realEnv, {MILESVAULT_DOCTOR_APP: prior.app, MILESVAULT_AUTH: prior.auth,
        DEPLOYMENT_ACCESS_POLICY: prior.policy});
    }
  });
}

async function denied(call: () => PromiseLike<unknown>, text = 'quarantined') {
  let error: unknown;
  try { await call(); } catch (e) { error = e; }
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain(text);
}

async function hidden(target: DurableObjectStub<OverseerDurableObject>, owner: string) {
  using closed = new RpcStub(() => {});
  await denied(() => target.open(owner, 'fixture@example.com', closed));
  await denied(() => target.open(owner, 'fixture@example.com', closed, 'guessed-share'));
  for (const method of ['getUiBundle', 'connectToGadget'] as const) {
    await denied(async () => {
      using opened = await target.open(owner, 'fixture@example.com', closed);
      using gadget = await opened.getGadget(1);
      return await gadget[method]();
    });
  }
  await runInDurableObject(target, async (o) => {
    const impl = o['impl'];
    await denied(() => impl.getSharingManager());
    await denied(() => impl.getGadgetUiBundle(1));
    await denied(() => impl.getGadgetUiSession(1));
    await denied(() => impl.getPrivateControlUi(1, owner));
    await denied(() => o.optInDoctorControls(owner, 1, 'a'.repeat(64)));
  });
}

describe('actual User -> new Overseer installer quarantine', () => {
  it('claims before RPC, initializes exact frozen files once, retries same IDs, and stays hidden', async () => {
    await fixture(async ({user, targets, stage, slot, ticket, publicConfirm, probePublic, cancel}) => {
      await probePublic();
      const result = await stage();
      expect((await slot()).workspaceId).toBe(result.workspaceId);
      expect(await stage()).toEqual(result);
      expect(await Promise.all(Array.from({length: 12}, () => stage()))).toEqual(Array(12).fill(result));
      const target = targets.get(targets.idFromString(result.workspaceId));
      await runInDurableObject(target, async (o, c) => {
        const record = c.storage.kv.get<{state: string; workpieceId: number}>(INSTALL_QUARANTINE_KEY)!;
        expect(record).toMatchObject({state: 'initialized', workpieceId: result.workpieceId});
        const gadgets = Array.from(o['impl'].storage.gadgets.list());
        expect(gadgets).toHaveLength(1);
        expect(gadgets[0]).not.toHaveProperty('doctorControls');
        const gadget = o['impl'].getGadgetRecord(result.workpieceId);
        expect(await o['impl'].gitStore.readCommitFiles(gadget.commitId!)).toEqual(new Map([
          ['README.md', 'Frozen fixture'], ['client.js', 'throw new Error("must not run")'],
          ['server.js', 'throw new Error("must not run")'],
        ]));
      });
      expect(await user.getGadget(result.workspaceId)).toBeNull();
      expect(await user.listGadgets()).toEqual([]);
      expect((await user.listOutputs()).outputs).toEqual([]);
      await hidden(target, user.id.toString());
      await denied(publicConfirm, 'No app was created');
      const original = await ticket();
      await cancel();
      expect((await slot()).workspaceId).toBeUndefined();
      await runInDurableObject(target, async (o, c) => {
        await o['impl'].updateSharedAlarm();
        expect(await c.storage.getAlarm()).toBe(original.expiresAt);
      });
      await denied(() => target.initializeDeploymentInstallQuarantine(original), 'unavailable');
      await hidden(target, user.id.toString());
    });
  });

  it('refuses another principal, incarnation, digest, or guessed target without disturbing the original', async () => {
    await fixture(async ({stage, ticket, targets, user, users, cancel}) => {
      const first = await stage();
      const original = await ticket();
      const target = targets.get(targets.idFromString(first.workspaceId));
      const b = users.get(users.newUniqueId());
      const subject = `other-${crypto.randomUUID()}@example.com`;
      await b.authenticateFromCfAccess(subject, true);
      await b.bindDeploymentIdentity({subject, storageKey: subject});
      await denied(() => b.stageDeploymentInstallAttempt(original.session, original.attempt, original.digest, subject), 'unavailable');
      for (const forged of [
        {...original, ownerId: b.id.toString()}, {...original, principal: subject},
        {...original, incarnation: crypto.randomUUID()}, {...original, digest: 'b'.repeat(64)},
        {...original, workspaceId: targets.newUniqueId().toString()},
      ]) {
        await denied(() => user.checkDeploymentInstallTarget(forged), 'unavailable');
        await denied(() => target.initializeDeploymentInstallQuarantine(forged), 'unavailable');
      }
      expect(await stage()).toEqual(first);
      expect(await b.listGadgets()).toEqual([]);
      await cancel();
    });
  });

  it('expired initialized allocation is cleaned on the original destination before a new generation', async () => {
    await fixture(async ({stage, ticket, targets, slot, fresh, user}) => {
      const first = await stage();
      const original = await ticket();
      vi.spyOn(Date, 'now').mockReturnValue(original.expiresAt + 1);
      const next = await fresh();
      const second = await next.stage();
      expect(second.workspaceId).not.toBe(first.workspaceId);
      const old = targets.get(targets.idFromString(first.workspaceId));
      await runInDurableObject(old, (o, c) => {
        expect(c.storage.kv.get(INSTALL_QUARANTINE_KEY)).toBeUndefined();
        expect(Array.from(o['impl'].storage.gadgets.list())).toEqual([]);
      });
      await denied(() => old.initializeDeploymentInstallQuarantine(original), 'unavailable');
      const s = await slot();
      await user.cancelDeploymentInstallAttempt(s.session, s.attempt);
    });
  });

  it('native lost init reply and target eviction retry the original mapping without a second Gadget', async () => {
    await fixture(async ({stage, targets, slot, cancel}) => {
      let first!: {workspaceId: string; workpieceId: number};
      const initialize = OverseerDurableObject.prototype.initializeDeploymentInstallQuarantine;
      const lostReply = vi.spyOn(OverseerDurableObject.prototype, 'initializeDeploymentInstallQuarantine')
        .mockImplementationOnce(async function(this: OverseerDurableObject, ticket) {
          const result = await initialize.call(this, ticket);
          first = {workspaceId: ticket.workspaceId, ...result};
          throw new Error('Injected lost init reply');
        });
      try { await denied(stage, 'unavailable'); } finally { lostReply.mockRestore(); }
      expect((await slot()).workspaceId).toBe(first.workspaceId);
      let target = targets.get(targets.idFromString(first.workspaceId));
      try { await runInDurableObject(target, (_o, c) => c.abort('quarantine reopen')); } catch { /* native eviction */ }
      target = targets.get(targets.idFromString(first.workspaceId));
      expect(await stage()).toEqual(first);
      await runInDurableObject(target, o => expect(Array.from(o['impl'].storage.gadgets.list())).toHaveLength(1));
      await cancel();
    });
  });

  for (const event of ['cancel', 'abort', 'reset', 'aba', 'expiry'] as const) {
    it(`fences ${event} while actual destination initialization is paused`, async () => {
      await fixture(async ({stage, targets, user, slot, ticket, pauseInit, cancel, abort}) => {
        const pause = pauseInit();
        const pending = denied(stage, 'unavailable');
        await pause.entered;
        const original = await ticket();
        expect(original.workspaceId).toMatch(/^[a-f0-9]{64}$/);
        const target = targets.get(targets.idFromString(original.workspaceId));
        using notify = new RpcStub(() => {});
        const guessedOpen = denied(() => target.open(user.id.toString(), 'fixture@example.com', notify));
        let closing: Promise<void> | undefined;
        if (event === 'cancel') closing = cancel();
        if (event === 'abort') abort.abort();
        if (event === 'reset' || event === 'aba') {
          await runInDurableObject(user, async (u, c) => {
            const identity = u['storage'].deploymentIdentity.get()!;
            if (event === 'reset') {
              await c.storage.deleteAll();
              await u.authenticateFromCfAccess(identity.subject, true);
            } else u['storage'].deploymentIdentity.put(null);
            await u.bindDeploymentIdentity(identity);
          });
        }
        if (event === 'expiry') vi.spyOn(Date, 'now').mockReturnValue(original.expiresAt + 1);
        pause.resume();
        await pending;
        await closing;
        await guessedOpen;
        await hidden(target, user.id.toString());
        await runInDurableObject(target, o => expect(Array.from(o['impl'].storage.gadgets.list())).toEqual([]));
        await denied(() => target.initializeDeploymentInstallQuarantine(original), 'unavailable');
        // Even a wiped User cannot orphan the destination's own durable expiry obligation.
        vi.spyOn(Date, 'now').mockReturnValue(original.expiresAt + 1);
        await runDurableObjectAlarm(target);
        await runInDurableObject(target, (o, c) => {
          expect(c.storage.kv.get(INSTALL_QUARANTINE_KEY)).toBeUndefined();
          expect(Array.from(o['impl'].storage.gadgets.list())).toEqual([]);
        });
        await denied(() => target.initializeDeploymentInstallQuarantine(original), 'unavailable');
        expect(await user.listGadgets()).toEqual([]);
        if (event !== 'reset') expect((await slot()).attempt).toBe(original.attempt);
      });
    });
  }

  it('cleanup failure retains original target through User reopen; ACK permits a new generation only', async () => {
    await fixture(async ({stage, targets, user, users, slot, ticket, cancel, fresh}) => {
      const first = await stage();
      const original = await ticket();
      let target = targets.get(targets.idFromString(first.workspaceId));
      await runInDurableObject(target, o => {
        Object.setPrototypeOf(o, Object.create(Object.getPrototypeOf(o), {
          cancelDeploymentInstallQuarantine: {value: async () => {throw new Error('Injected cleanup failure');}},
        }));
      });
      await denied(cancel, 'cleanup failure');
      expect(await slot()).toMatchObject({workspaceId: first.workspaceId, cancelled: true});
      try { await runInDurableObject(user, (_u, c) => c.abort('User quarantine reopen')); } catch { /* native eviction */ }
      user = users.get(user.id);
      expect(await slot()).toMatchObject({workspaceId: first.workspaceId, cancelled: true});
      await denied(stage, 'unavailable');
      try { await runInDurableObject(target, (_o, c) => c.abort('cleanup transport recovered')); } catch { /* native eviction */ }
      target = targets.get(target.id);
      const cleanup = OverseerDurableObject.prototype.cancelDeploymentInstallQuarantine;
      const lostAck = vi.spyOn(OverseerDurableObject.prototype, 'cancelDeploymentInstallQuarantine')
        .mockImplementationOnce(async function(this: OverseerDurableObject, admission) {
          await cleanup.call(this, admission);
          throw new Error('Injected lost cleanup ACK');
        });
      try { await denied(cancel, 'lost cleanup ACK'); } finally { lostAck.mockRestore(); }
      expect((await slot()).workspaceId).toBe(first.workspaceId);
      await cancel();
      expect((await slot()).workspaceId).toBeUndefined();
      try { await runInDurableObject(target, (_o, c) => c.abort('closed quarantine reopen')); } catch { /* native eviction */ }
      target = targets.get(target.id);
      await denied(() => target.initializeDeploymentInstallQuarantine(original), 'unavailable');
      await runInDurableObject(user, (_u, c) => {
        const s = c.storage.kv.get<Slot>(SLOT)!;
        c.storage.kv.put(SLOT, {...s, expiresAt: Date.now() - 1});
      });
      const next = await fresh();
      const second = await next.stage();
      expect(second.workspaceId).not.toBe(first.workspaceId);
      await user.cancelDeploymentInstallAttempt(original.session, original.attempt);
      expect((await slot()).workspaceId).toBe(second.workspaceId);
      await denied(() => target.initializeDeploymentInstallQuarantine(original), 'unavailable');
      expect(await next.stage()).toEqual(second);
      const s = await slot();
      await user.cancelDeploymentInstallAttempt(s.session, s.attempt);
    });
  });
});
