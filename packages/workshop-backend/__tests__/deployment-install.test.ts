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
  expireAttempt: (userId: string) => Promise<void>;
}) => Promise<void>) {
  const anchor = env.TEST_OVERSEER.getByName(crypto.randomUUID());
  await runInDurableObject(anchor, async (instance, ctx) => {
    const abort = new AbortController();
    let descriptor = release;
    let allowed = true;
    let releasePause: (() => Promise<void>) | undefined;
    const context = Object.assign(createExecutionContext(), {
      exports: ctx.exports, waitUntil: (promise: Promise<unknown>) => ctx.waitUntil(promise),
    });
    const testEnv = {...instance['env'], MILESVAULT_AUTH: 'true'};
    // Binding fixtures are data/role authorities, not installer or approval implementations.
    Object.assign(testEnv, {
      MILESVAULT_DOCTOR_APP: {getDeploymentInstallRelease: async () => {await releasePause?.(); return descriptor;}},
      DEPLOYMENT_ACCESS_POLICY: {checkAccess: async () => allowed
        ? {allowed: true, validUntil: Date.now() + 60_000} : {allowed: false, reason: 'denied'}},
    });
    const suffix = crypto.randomUUID();
    const root = new PublicApiImpl(context, testEnv, reason => abort.abort(reason),
      {email: `a-${suffix}@example.com`, externalIdentityKey: `A-${suffix}@example.com`}, abort.signal);
    const other = new PublicApiImpl(context, testEnv, () => {},
      {email: `b-${suffix}@example.com`, externalIdentityKey: `B-${suffix}@example.com`});
    await run({root, other, abort, changeRelease: next => {descriptor = next;}, revoke: () => {allowed = false;},
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
      await b.cancelDeploymentInstall(first.attempt);
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

  it('rejects oversized publisher text and unknown descriptor selectors before User preparation', async () => {
    await scenario(async ({root, changeRelease}) => {
      const a = await root.authenticateFromCfAccess();
      changeRelease({...release, title: 'x'.repeat(101)});
      await expect(a.prepareDeploymentInstall(release.releaseId)).rejects.toThrow('unavailable');
      changeRelease(Object.assign({...release}, {owner: 'forged'}));
      await expect(a.prepareDeploymentInstall(release.releaseId)).rejects.toThrow('unavailable');
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
