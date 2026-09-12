import { env } from 'cloudflare:workers';
import { createExecutionContext, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { PublicApiImpl } from '../src/server.js';
import type { DeploymentInstallRelease } from '@gadgets/workshop-shared/deployment-install';
import type { OverseerDurableObject } from '../src/overseer.js';

declare global { namespace Cloudflare {
  interface Env { TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>; }
} }

// Synthetic publisher data only. Actual PublicApi -> authenticated root -> native User storage.
const release: DeploymentInstallRelease = {
  releaseId: 'fixture.controls.v1', protocol: 1, blueprintId: 'fixture.controls.v1.blueprint',
  artifact: 'fixture/client.js', uiSha256: 'a'.repeat(64), factory: 'doctor-controls-v1',
  hostRuntime: 'private-install-v1', title: 'Install fixture controls', explanation: 'No scan or approval.',
  confirmLabel: 'Install new fixture controls',
};

async function scenario(run: (context: {
  root: PublicApiImpl; other: PublicApiImpl; abort: AbortController;
  changeRelease: (next: DeploymentInstallRelease) => void;
  revoke: () => void;
  pauseRelease: () => {entered: Promise<void>; resume: () => void};
  pauseAccess: (skip?: number) => {entered: Promise<void>; resume: () => void};
  identity: (userId: string, mode: 'reset' | 'rebind' | 'remove' | 'aba') => Promise<void>;
  checkEffects: (userId: string) => Promise<void>;
  expireAttempt: (userId: string) => Promise<void>;
}) => Promise<void>) {
  const anchor = env.TEST_OVERSEER.getByName(crypto.randomUUID());
  await runInDurableObject(anchor, async (instance, ctx) => {
    const abort = new AbortController();
    let descriptor = release;
    let allowed = true;
    let releasePause: (() => Promise<void>) | undefined;
    let accessPause: (() => Promise<void>) | undefined;
    const context = Object.assign(createExecutionContext(), {
      exports: ctx.exports, waitUntil: (promise: Promise<unknown>) => ctx.waitUntil(promise),
    });
    const testEnv = {...instance['env'], MILESVAULT_AUTH: 'true'};
    // Binding fixtures are data/role authorities, not installer or approval implementations.
    Object.assign(testEnv, {
      MILESVAULT_DOCTOR_APP: {getDeploymentInstallRelease: async () => {await releasePause?.(); return descriptor;}},
      DEPLOYMENT_ACCESS_POLICY: {checkAccess: async () => {
        // Capture an affirmative response BEFORE pausing, as a stale in-flight policy reply.
        const result = allowed ? {allowed: true, validUntil: Date.now() + 60_000}
          : {allowed: false, reason: 'denied'};
        await accessPause?.();
        return result;
      }},
      DEPLOYMENT_USAGE_POLICY: new Proxy({}, {get: () => {throw new Error('Unexpected usage authority');}}),
    });
    const suffix = crypto.randomUUID();
    const root = new PublicApiImpl(context, testEnv, reason => abort.abort(reason),
      {email: `a-${suffix}@example.com`, externalIdentityKey: `A-${suffix}@example.com`}, abort.signal);
    const other = new PublicApiImpl(context, testEnv, () => {},
      {email: `b-${suffix}@example.com`, externalIdentityKey: `B-${suffix}@example.com`});
    await run({root, other, abort, changeRelease: next => {descriptor = next;}, revoke: () => {allowed = false;},
      identity: async (userId, mode) => {
        const user = ctx.exports.UserDurableObject.get(ctx.exports.UserDurableObject.idFromString(userId));
        await runInDurableObject(user, async (u, c) => {
          const identity = u['storage'].deploymentIdentity.get()!;
          if (mode === 'reset') {
            // Supported native storage reset and real ingress binding, not a forged epoch/slot.
            await c.storage.deleteAll();
            await u.authenticateFromCfAccess(identity.subject, true);
            await u.bindDeploymentIdentity(identity);
          } else if (mode === 'rebind') {
            await u.bindDeploymentIdentity({storageKey: identity.storageKey, subject: identity.subject});
          } else {
            // Separate fault coverage for retained-slot ABA; rebind rotates the real User epoch.
            u['storage'].deploymentIdentity.put(null);
            if (mode === 'aba') await u.bindDeploymentIdentity(identity);
          }
        });
      },
      checkEffects: async userId => {
        const user = ctx.exports.UserDurableObject.get(ctx.exports.UserDurableObject.idFromString(userId));
        await runInDurableObject(user, (u, c) => {
          expect(Array.from(u['storage'].gadgets.list())).toEqual([]);
          expect(c.storage.sql.exec("SELECT name FROM sqlite_master WHERE name LIKE 'usage_%'").toArray()).toEqual([]);
          expect(Array.from(c.storage.kv.list({prefix: 'deployment-install-attempt-v1'})).length).toBeLessThanOrEqual(1);
        });
      },
      pauseAccess: (skip = 0) => {
        let enter!: () => void; let resume!: () => void;
        const entered = new Promise<void>(resolve => {enter = resolve;});
        const paused = new Promise<void>(resolve => {resume = resolve;});
        accessPause = async () => {if (skip-- > 0) return; enter(); await paused;};
        return {entered, resume};
      },
      pauseRelease: () => {
        let enter!: () => void;
        let resume!: () => void;
        const entered = new Promise<void>(resolve => {enter = resolve;});
        const paused = new Promise<void>(resolve => {resume = resolve;});
        releasePause = async () => {enter(); await paused;};
        return {entered, resume};
      },
      expireAttempt: async userId => {
        const user = ctx.exports.UserDurableObject.get(ctx.exports.UserDurableObject.idFromString(userId));
        await runInDurableObject(user, (_user, userCtx) => {
          const slots = Array.from(userCtx.storage.kv.list({prefix: 'deployment-install-attempt-v1'}));
          expect(slots).toHaveLength(1);
          const [key, record] = slots[0] as [string, {expiresAt: number}];
          userCtx.storage.kv.put(key, {...record, expiresAt: Date.now() - 1});
        });
      },
    });
    expect(Array.from(instance['impl'].storage.gadgets.list())).toEqual([]);
  });
}

describe('unoffered deployment installation auth-root split', () => {
  it('durably retries preparation for A, rejects B, and never creates a workspace on confirmation', async () => {
    await scenario(async ({root, other}) => {
      const a = await root.authenticateFromCfAccess();
      const b = await other.authenticateFromCfAccess();
      const first = await a.prepareDeploymentInstall(release.releaseId);
      expect(first.principal).toMatch(/^A-/);
      const retry = await a.prepareDeploymentInstall(release.releaseId);
      expect(retry).toEqual(first);
      await expect(b.confirmDeploymentInstall(first.attempt)).rejects.toThrow('unavailable');
      await expect(a.confirmDeploymentInstall(first.attempt)).rejects.toThrow('No app was created');
      await expect(a.confirmDeploymentInstall(first.attempt)).rejects.toThrow('No app was created');
      expect(await a.listGadgets()).toEqual([]);
      expect(await b.listGadgets()).toEqual([]);
      const reloaded = await root.authenticateFromCfAccess();
      await expect(reloaded.confirmDeploymentInstall(first.attempt)).rejects.toThrow('unavailable');
    });
  });

  it('cancellation invalidates retry; a stale B cancellation cannot affect A', async () => {
    await scenario(async ({root, other}) => {
      const a = await root.authenticateFromCfAccess();
      const b = await other.authenticateFromCfAccess();
      const first = await a.prepareDeploymentInstall(release.releaseId);
      await expect(b.cancelDeploymentInstall(first.attempt)).rejects.toThrow('unavailable');
      await expect(a.confirmDeploymentInstall(first.attempt)).rejects.toThrow('No app was created');
      await a.cancelDeploymentInstall(first.attempt);
      await expect(a.confirmDeploymentInstall(first.attempt)).rejects.toThrow('unavailable');
      await expect(a.prepareDeploymentInstall(release.releaseId)).rejects.toThrow('unavailable');
      expect(await a.listGadgets()).toEqual([]);
    });
  });

  it('denies changed descriptor, extra arguments, unknown release and aborted session', async () => {
    await scenario(async ({root, changeRelease, abort}) => {
      const a = await root.authenticateFromCfAccess();
      await expect(a.prepareDeploymentInstall('unknown')).rejects.toThrow('unavailable');
      // The public method checks arity itself rather than stripping a forged selector.
      await expect(a.prepareDeploymentInstall(release.releaseId, {owner: 'B'})).rejects.toThrow('unavailable');
      const first = await a.prepareDeploymentInstall(release.releaseId);
      await expect(a.confirmDeploymentInstall(first.attempt, {hash: 'substituted'})).rejects.toThrow('unavailable');
      await expect(a.cancelDeploymentInstall(first.attempt, {owner: 'B'})).rejects.toThrow('unavailable');
      changeRelease({...release, explanation: 'Replacement review text'});
      await expect(a.confirmDeploymentInstall(first.attempt)).rejects.toThrow('unavailable');
      changeRelease(release);
      abort.abort();
      await expect(a.confirmDeploymentInstall(first.attempt)).rejects.toThrow('unavailable');
      await expect(a.prepareDeploymentInstall(release.releaseId)).rejects.toThrow('unavailable');
    });
  });

  it('rejects oversized publisher text and projects away unknown publisher fields before preparation', async () => {
    await scenario(async ({root, changeRelease}) => {
      const a = await root.authenticateFromCfAccess();
      changeRelease({...release, title: 'x'.repeat(101)});
      await expect(a.prepareDeploymentInstall(release.releaseId)).rejects.toThrow('unavailable');
      changeRelease(Object.assign({...release}, {owner: 'forged'}));
      expect((await a.prepareDeploymentInstall(release.releaseId)).release).toEqual(release);
      changeRelease(release);
      expect((await a.prepareDeploymentInstall(release.releaseId)).release).toEqual(release);
      expect(await a.listGadgets()).toEqual([]);
    });
  });

  it('expiry of the single durable slot refuses confirmation', async () => {
    await scenario(async ({root, expireAttempt}) => {
      const a = await root.authenticateFromCfAccess();
      const first = await a.prepareDeploymentInstall(release.releaseId);
      await expireAttempt(await a.getRecoveryPrincipal());
      await expect(a.confirmDeploymentInstall(first.attempt)).rejects.toThrow('unavailable');
      expect(await a.listGadgets()).toEqual([]);
    });
  });

  for (const event of ['abort', 'revoke', 'cancel'] as const) {
    it(`rejects ${event} while the confirmation descriptor reply is delayed`, async () => {
      await scenario(async ({root, abort, revoke, pauseRelease}) => {
        const a = await root.authenticateFromCfAccess();
        const first = await a.prepareDeploymentInstall(release.releaseId);
        const pause = pauseRelease();
        const pending = a.confirmDeploymentInstall(first.attempt);
        // Attach the rejection assertion before releasing a native delayed reply.
        const rejected = expect(pending).rejects.toThrow('unavailable');
        await pause.entered;
        if (event === 'abort') abort.abort();
        else if (event === 'revoke') revoke();
        else await a.cancelDeploymentInstall(first.attempt);
        pause.resume();
        await rejected;
        expect(await a.listGadgets()).toEqual([]);
      });
    });
  }

  it('fresh auth policy denial refuses preparation without allocating', async () => {
    await scenario(async ({root, revoke}) => {
      const a = await root.authenticateFromCfAccess();
      revoke();
      await expect(a.prepareDeploymentInstall(release.releaseId)).rejects.toThrow('unavailable');
      expect(await a.listGadgets()).toEqual([]);
    });
  });
});


describe('durable identity and last-policy fencing', () => {
  for (const mode of ['reset', 'aba', 'remove', 'rebind'] as const) {
    it(`${mode} between prepare and confirm uses User incarnation, not canonical key`, async () => {
      await scenario(async ({root, identity, checkEffects}) => {
        const a = await root.authenticateFromCfAccess();
        const id = await a.getRecoveryPrincipal();
        const first = await a.prepareDeploymentInstall(release.releaseId);
        await identity(id, mode);
        await expect(a.confirmDeploymentInstall(first.attempt)).rejects.toThrow(
          mode === 'rebind' ? 'No app was created' : 'unavailable');
        if (mode === 'rebind') expect(await a.prepareDeploymentInstall(release.releaseId)).toEqual(first);
        await checkEffects(id);
        expect(await a.listGadgets()).toEqual([]);
      });
    });
  }

  for (const operation of ['prepare', 'confirm'] as const) {
    for (const event of ['reset', 'aba', 'remove', 'rebind', 'cancel', 'expiry', 'abort'] as const) {
      it(`${operation} rechecks ${event} after the LAST paused affirmative policy response`, async () => {
        await scenario(async ({root, identity, pauseAccess, expireAttempt, abort, checkEffects}) => {
          const a = await root.authenticateFromCfAccess();
          const id = await a.getRecoveryPrincipal();
          // A retry gives cancellation a real token while still exercising prepare's last await.
          const first = await a.prepareDeploymentInstall(release.releaseId);
          const pause = pauseAccess(operation === 'prepare' ? 1 : 0);
          const pending = operation === 'prepare' ? a.prepareDeploymentInstall(release.releaseId)
            : a.confirmDeploymentInstall(first.attempt);
          const checked = event === 'rebind' && operation === 'prepare'
            ? expect(pending).resolves.toEqual(first)
            : expect(pending).rejects.toThrow(event === 'rebind' ? 'No app was created' : 'unavailable');
          await pause.entered;
          if (event === 'cancel') await a.cancelDeploymentInstall(first.attempt);
          else if (event === 'expiry') await expireAttempt(id);
          else if (event === 'abort') abort.abort();
          else await identity(id, event);
          pause.resume();
          await checked;
          await checkEffects(id);
          expect(await a.listGadgets()).toEqual([]);
        });
      });
    }
  }

  for (const event of ['reset', 'aba', 'remove', 'expiry'] as const) {
    it(`initial prepare refuses ${event} during its last policy response`, async () => {
      await scenario(async ({root, identity, pauseAccess, expireAttempt, checkEffects}) => {
        const a = await root.authenticateFromCfAccess();
        const id = await a.getRecoveryPrincipal();
        const pause = pauseAccess(1);
        const denied = expect(a.prepareDeploymentInstall(release.releaseId)).rejects.toThrow('unavailable');
        await pause.entered;
        if (event === 'expiry') await expireAttempt(id);
        else await identity(id, event);
        pause.resume();
        await denied;
        await checkEffects(id);
      });
    });
  }

  for (const stage of ['access', 'release'] as const) {
    it(`initial prepare cannot adopt a replacement identity during ${stage}`, async () => {
      await scenario(async ({root, identity, pauseAccess, pauseRelease, checkEffects}) => {
        const a = await root.authenticateFromCfAccess();
        const id = await a.getRecoveryPrincipal();
        const pause = stage === 'access' ? pauseAccess() : pauseRelease();
        const denied = expect(a.prepareDeploymentInstall(release.releaseId)).rejects.toThrow('unavailable');
        await pause.entered;
        await identity(id, 'aba');
        pause.resume();
        await denied;
        await checkEffects(id);
      });
    });
  }

  it('expired cancelled slot is replaced once; stale cancellation and burst retry never renew it', async () => {
    await scenario(async ({root, expireAttempt, checkEffects}) => {
      const a = await root.authenticateFromCfAccess();
      const id = await a.getRecoveryPrincipal();
      const first = await a.prepareDeploymentInstall(release.releaseId);
      await a.cancelDeploymentInstall(first.attempt);
      await expireAttempt(id);
      const burst = await Promise.all(Array.from({length: 20}, () => a.prepareDeploymentInstall(release.releaseId)));
      const next = burst[0];
      expect(next.attempt).not.toBe(first.attempt);
      for (const result of burst) expect(result).toEqual(next);
      await expect(a.cancelDeploymentInstall(first.attempt)).rejects.toThrow('unavailable');
      await expect(a.confirmDeploymentInstall(first.attempt)).rejects.toThrow('unavailable');
      await expect(a.confirmDeploymentInstall(next.attempt)).rejects.toThrow('No app was created');
      expect(await a.prepareDeploymentInstall(release.releaseId)).toEqual(next);
      await checkEffects(id);
    });
  });
});
