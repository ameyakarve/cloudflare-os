import {env, RpcStub, RpcTarget} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {expect, it} from 'vitest';
import type {UserDurableObject} from '../src/user';
import type {OverseerDurableObject} from '../src/overseer';
import {UsageScope} from '../src/deployment-usage';
import type {UsageGrant} from '@gadgets/workshop-shared/deployment-usage';

declare module 'cloudflare:workers' {
  interface ProvidedEnv {
    TEST_USER: DurableObjectNamespace<UserDurableObject>;
    TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>;
  }
}

it('finishes a received root when its grant fails validation', async () => {
  let finishes = 0;
  class Run extends RpcTarget {
    async getGrant(): Promise<UsageGrant> { return {allowed: true, runId: 'expired', expiresAt: 1}; }
    async reserve() { throw new Error('must not admit'); }
    async settleTokens() {}
    async finish() { finishes++; }
  }
  await expect(UsageScope.open(new RpcStub(new Run()))).rejects.toThrow('expired');
  expect(finishes).toBe(1);
});

it('legacy optional Overseer retains and finishes a late User root without releasing it to the caller', async () => {
  await runInDurableObject(env.TEST_OVERSEER.getByName('late-user-root'), async instance => {
    const impl = instance['impl'];
    const users = impl.users, required = impl.env.DEPLOYMENT_USAGE_REQUIRED, policy = impl.env.DEPLOYMENT_USAGE_POLICY,
      check = impl.checkDeploymentAccess;
    impl.ownerId = users.idFromName('synthetic-owner').toString();
    // V1 regression only. Required controls now deliberately select pairedV2, covered separately.
    impl.env.DEPLOYMENT_USAGE_REQUIRED = undefined;
    Object.assign(impl.env, {DEPLOYMENT_USAGE_POLICY: {}});
    impl.checkDeploymentAccess = async () => undefined;
    let resolve!: (root: RpcStub<Run>) => void;
    const late = new Promise<RpcStub<Run>>(r => { resolve = r; });
    let finishes = 0, reservations = 0;
    class Run extends RpcTarget {
      async finish() { finishes++; }
      async reserve() { reservations++; }
    }
    const root = new RpcStub(new Run()); // Ownership transfers to the timed-out acquisition.
    Object.assign(impl, {users: {idFromString: users.idFromString.bind(users), get: () => ({beginDeploymentUsageRun: () => late})}});
    try {
      await expect(impl.getUsageBudget({from: 'user'})).rejects.toThrow('unavailable');
      resolve(root);
      await new Promise(r => setTimeout(r, 20));
      expect(finishes).toBe(1);
      expect(reservations).toBe(0);
    } finally {
      impl.users = users; impl.env.DEPLOYMENT_USAGE_REQUIRED = required;
      impl.env.DEPLOYMENT_USAGE_POLICY = policy; impl.checkDeploymentAccess = check;
    }
  });
}, 10000);

it('real User retains a separately delayed policy grant and finishes it without constructing caller authority', async () => {
  const user = env.TEST_USER.getByName('late-policy-root');
  await user.authenticateFromCfAccess('fixture@example.test', true);
  await user.bindDeploymentIdentity({subject: 'fixture@example.test', storageKey: 'Fixture@example.test'});
  await runInDurableObject(user, async instance => {
    const e = instance['env'], access = e.DEPLOYMENT_ACCESS_POLICY, policy = e.DEPLOYMENT_USAGE_POLICY;
    let resolve!: (grant: UsageGrant) => void;
    const late = new Promise<UsageGrant>(r => { resolve = r; });
    let id = '', finishes = 0, reservations = 0;
    Object.assign(e, {
      DEPLOYMENT_ACCESS_POLICY: {checkAccess: async () => ({allowed: true, validUntil: Date.now() + 60000})},
      DEPLOYMENT_USAGE_POLICY: {
        beginRun: async (key: string, runId: string) => { expect(key).toBe('Fixture@example.test'); id = runId; return late; },
        finishRun: async (key: string, runId: string) => { expect(key).toBe('Fixture@example.test'); expect(runId).toBe(id); finishes++; },
        reserve: async () => { reservations++; return {allowed: true}; },
      },
    });
    try {
      await expect(instance.beginDeploymentUsageRun()).rejects.toThrow('unavailable');
      expect(id).toMatch(/^[a-f0-9-]{36}$/); // Minted inside User, not supplied by a browser.
      resolve({allowed: true, runId: id, expiresAt: Date.now() + 60000});
      await new Promise(r => setTimeout(r, 20));
      expect(finishes).toBe(1); expect(reservations).toBe(0);
    } finally { e.DEPLOYMENT_ACCESS_POLICY = access; e.DEPLOYMENT_USAGE_POLICY = policy; }
  });
}, 10000);
