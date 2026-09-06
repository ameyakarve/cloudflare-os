import { env } from 'cloudflare:workers';
import { runInDurableObject, abortAllDurableObjects } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { UserDurableObject } from '../src/user.js';
import type { OverseerDurableObject } from '../src/overseer.js';
import type { DeploymentAccessPolicy } from '@gadgets/workshop-shared/deployment-access';
import type { IdentityTestHook } from './deployment-identity-worker.js';

declare module 'cloudflare:workers' {
  interface ProvidedEnv {
    TEST_USER: DurableObjectNamespace<UserDurableObject>;
    TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>;
  }
}

describe('stored identity and retained hook authorization', () => {
  it('checks the stored exact key and revalidates after restart', async () => {
    const name = 'access-grant-user';
    let user = env.TEST_USER.getByName(name);
    await user.authenticateFromCfAccess('member@example.com', true);
    await user.bindDeploymentIdentity({subject: 'member@example.com', storageKey: 'Member@example.com'});
    await runInDurableObject(user, async (instance, ctx) => {
      const saved = instance['env'].DEPLOYMENT_ACCESS_POLICY;
      instance['env'].DEPLOYMENT_ACCESS_POLICY = ctx.exports.IdentityTestAccessPolicy({props: {key: 'Member@example.com', allowed: true}});
      try { expect(await instance.getDeploymentAccessGrant()).toMatchObject({allowed: true}); }
      finally { instance['env'].DEPLOYMENT_ACCESS_POLICY = saved; }
    });
    await abortAllDurableObjects();
    user = env.TEST_USER.getByName(name);
    await runInDurableObject(user, async (instance, ctx) => {
      const saved = instance['env'].DEPLOYMENT_ACCESS_POLICY;
      instance['env'].DEPLOYMENT_ACCESS_POLICY = ctx.exports.IdentityTestAccessPolicy({props: {key: 'Member@example.com', allowed: false}});
      try { await expect(instance.getDeploymentAccessGrant()).rejects.toThrow('no longer active'); }
      finally { instance['env'].DEPLOYMENT_ACCESS_POLICY = saved; }
    });
  });

  it('refuses new hook starts, retained callbacks, observations and writes after owner revocation', async () => {
    const user = env.TEST_USER.getByName('access-hook-owner');
    await user.authenticateFromCfAccess('hook@example.com', true);
    await user.bindDeploymentIdentity({subject: 'hook@example.com', storageKey: 'Hook@example.com'});
    let allowed = true;
    async function installPolicy() {
      await runInDurableObject(user, instance => {
        // A context-free policy fixture keeps the cross-DO call real without transporting
        // a ctx.exports factory created inside another DO's test callback.
        const policy = {checkAccess: async (key: string) => key === 'Hook@example.com' && allowed
          ? {allowed: true as const, validUntil: Date.now() + 100}
          : {allowed: false as const, reason: 'denied' as const}} satisfies Pick<DeploymentAccessPolicy, 'checkAccess'>;
        Object.assign(instance['env'], {DEPLOYMENT_ACCESS_POLICY: policy});
      });
    }
    await installPolicy();
    const overseer = env.TEST_OVERSEER.getByName('access-hook-workspace');
    try { await runInDurableObject(overseer, async (instance, ctx) => {
      const impl = instance['impl'];
      const oldRequired = instance['env'].DEPLOYMENT_ACCESS_REQUIRED;
      const oldBlueprints = instance['env'].BLUEPRINTS;
      instance['env'].DEPLOYMENT_ACCESS_REQUIRED = 'true';
      // Identity checks cross into the real User DO; admin-config storage is irrelevant here.
      instance['env'].BLUEPRINTS = {get: async () => null} as unknown as KVNamespace;
      impl.ownerId = user.id.toString();
      impl.users = env.TEST_USER;
      impl.storage.gatekeepers.put({id: 1, resourceTitle: 'Schedule fixture',
        class: ctx.exports.IdentityTestGatekeeper({props: {subject: 'hook@example.com', storageKey: 'Hook@example.com'}}),
        creationSpec: {type: 'ambient', vendorId: 'scheduler', accountId: 1},
      });
      type Hook = Parameters<typeof impl.storage.boundHooks.put>[0];
      const callback = ctx.exports.IdentityTestHook({});
      impl.storage.boundHooks.put({id: 1, actionId: 1, gatekeeperId: 1, vendorId: 'scheduler',
        enabled: true, description: {title: 'Fixture', description: 'No external effects'},
        callback: callback as unknown as Hook['callback'], controller: callback,
      });
      try {
        const firing = await instance.startHook(1);
        const target = firing.callback as unknown as Pick<IdentityTestHook, 'deliver'>;
        expect(await target.deliver()).toBe('delivered');
        allowed = false;
        let failure = '';
        try { await target.deliver(); } catch (error) { failure = String(error); }
        expect(failure).toMatch(/access|Access/);
        await expect(instance.startHook(1)).rejects.toThrow();
        await expect(impl.authorizeObservation(1, {title: 'Fixture', description: 'Read'}, {from: 'hook'}))
          .rejects.toThrow();
        await expect(impl.submitAction(1, 2, {title: 'Fixture', description: 'Write', implementsRevert: false}, {from: 'hook'}))
          .rejects.toThrow();
        firing.callback[Symbol.dispose]();
      } finally {
        instance['env'].DEPLOYMENT_ACCESS_REQUIRED = oldRequired;
        instance['env'].BLUEPRINTS = oldBlueprints;
      }
    }); } finally {
      await runInDurableObject(user, instance => { delete instance['env'].DEPLOYMENT_ACCESS_POLICY; });
    }
  });
});
