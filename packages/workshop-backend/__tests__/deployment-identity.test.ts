import { describe, expect, it, vi } from 'vitest';
import { deploymentIdentity, accountProvider } from '../src/deployment-identity.js';
import { UserDurableObject } from '../src/user.js';
import { env } from 'cloudflare:workers';
import { abortAllDurableObjects, runInDurableObject } from 'cloudflare:test';
import type { IdentityTestAccount, IdentityTestGatekeeper } from './deployment-identity-worker.js';
import type { OverseerDurableObject } from '../src/overseer.js';

declare module 'cloudflare:workers' {
  interface ProvidedEnv {
    TEST_USER: DurableObjectNamespace<UserDurableObject>;
    TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>;
  }
}

describe('deployment identity', () => {
  it('keeps canonical email keys exact while retaining existing Workshop subjects', () => {
    expect(deploymentIdentity('Member.Name@example.com')).toEqual({
      subject: 'member.name@example.com', storageKey: 'Member.Name@example.com',
    });
  });

  it('accepts opaque and Discord storage keys without normalizing them', () => {
    for (const key of ['123456789012345678', 'OpaqueCaseSensitiveKey']) {
      expect(deploymentIdentity(key)).toEqual({subject: key, storageKey: key});
    }
  });

  it.each([null, '', ' user@example.com', 'user@example.com ', 'a\nb', 'x'.repeat(255)])(
    'rejects malformed trusted headers rather than silently changing the key', key => {
      expect(() => deploymentIdentity(key)).toThrow('Missing trusted deployment identity');
    });

  it('resolves only explicitly configured private providers', () => {
    const provider = {createAccount: vi.fn()};
    const env = {ACCOUNT_PROVIDER_LEDGER: provider, GATEKEEPER_CONTEXT: provider} as unknown as Cloudflare.Env;
    expect(accountProvider(env, 'ledger')).toBe(provider);
    expect(accountProvider(env, 'context')).toBeUndefined();
  });

  it('binds a verified identity once and refuses a different canonical key', async () => {
    let user = env.TEST_USER.getByName('identity-bind-once');
    await user.authenticateFromCfAccess('member@example.com', true);
    await user.bindDeploymentIdentity(deploymentIdentity('Member@example.com'));
    await abortAllDurableObjects();
    user = env.TEST_USER.getByName('identity-bind-once');
    await user.bindDeploymentIdentity(deploymentIdentity('Member@example.com'));
    let failure = '';
    try { await user.bindDeploymentIdentity(deploymentIdentity('member@example.com')); }
    catch (error) { failure = String(error); }
    expect(failure).toContain('cannot be changed implicitly');
    try { await user.bindDeploymentIdentity(deploymentIdentity('other@example.com')); }
    catch (error) { failure = String(error); }
    expect(failure).toContain('does not match');
  });

  it('repairs a stored account capability without changing its ID and persists the exact verifier', async () => {
    const name = 'identity-repair';
    let user = env.TEST_USER.getByName(name);
    await user.authenticateFromCfAccess('member@example.com', true);
    await runInDurableObject(user, async (instance, ctx) => {
      const storage = instance['storage'];
      Object.assign(instance['env'], {ACCOUNT_PROVIDER_LEDGER: ctx.exports.IdentityTestProvider({})});
      storage.nextAccountId.put(8);
      storage.connectedAccounts.put({id: 7, vendorId: 'ledger', autoProvisioned: true,
        account: ctx.exports.IdentityTestAccount({props: deploymentIdentity('member@example.com')}),
        description: {displayName: 'Legacy fixture', singleton: {tsType: 'IdentityFixture'}},
      });
      await instance.bindDeploymentIdentity(deploymentIdentity('Member@example.com'));
      const repaired = storage.connectedAccounts.get(7)!;
      expect(repaired.deploymentStorageKey).toBe('Member@example.com');
      expect(repaired.revision).toBe(1);
      expect(storage.nextAccountId.get()).toBe(8);
      await instance.bindDeploymentIdentity(deploymentIdentity('Member@example.com'));
      expect(storage.connectedAccounts.get(7)?.revision).toBe(1);
    });
    await abortAllDurableObjects();
    user = env.TEST_USER.getByName(name);
    const verifier = await user.getVerifier(7, 'ledger') as unknown as Pick<IdentityTestAccount, 'getStorageKey'>;
    expect(await verifier.getStorageKey()).toBe('Member@example.com');
    let failure = '';
    try { await user.getVerifier(7, 'other'); } catch (error) { failure = String(error); }
    expect(failure).toContain('Invalid account selection');
  });

  it('refreshes an ambient facet in place while preserving its SQLite state and gadget bindings', async () => {
    const overseer = env.TEST_OVERSEER.getByName('identity-facet-refresh');
    await runInDurableObject(overseer, async (instance, ctx) => {
      const impl = instance['impl'];
      const exact = deploymentIdentity('Member@example.com');
      impl.ownerId = 'owner';
      const owner = {
        syncWorkspaceOutputs: async () => {},
        listProvidedAccounts: async () => [{accountId: 7, vendorId: 'ledger', revision: 1,
          description: {displayName: 'Identity fixture', singleton: {tsType: 'IdentityFixture'}}}],
        getSingletonGatekeeperClass: async () => ctx.exports.IdentityTestGatekeeper({props: exact}),
      } satisfies Pick<UserDurableObject, 'listProvidedAccounts' | 'getSingletonGatekeeperClass' | 'syncWorkspaceOutputs'>;
      Object.assign(impl, {users: {idFromString: (id: string) => id, get: () => owner}});
      impl.storage.gatekeepers.put({id: 7, resourceTitle: 'Identity fixture',
        class: ctx.exports.IdentityTestGatekeeper({props: deploymentIdentity('member@example.com')}),
        creationSpec: {type: 'ambient', vendorId: 'ledger', accountId: 7},
      });
      impl.storage.gadgets.put({type: 'gadget', id: 3, title: 'Fixture', created: new Date(0),
        bindingName: 'FIXTURE', bindings: {LEDGER: {target: 7}},
      });
      type Fixture = Pick<IdentityTestGatekeeper, 'getStorageKey' | 'putMarker' | 'getMarker'>;
      const oldFacet = impl.getGatekeeperFacet(7) as unknown as Fixture;
      await oldFacet.putMarker('retained review history');
      expect(await oldFacet.getStorageKey()).toBe('member@example.com');
      await impl.ensureAmbientCapsules();
      const refreshed = impl.getGatekeeperFacet(7) as unknown as Fixture;
      expect(await refreshed.getStorageKey()).toBe('Member@example.com');
      expect(await refreshed.getMarker()).toBe('retained review history');
      expect(impl.storage.gadgets.get(3)?.bindings).toEqual({LEDGER: {target: 7}});
      expect(impl.storage.gatekeepers.get(7)?.creationSpec).toEqual({
        type: 'ambient', vendorId: 'ledger', accountId: 7, accountRevision: 1,
      });
      await impl.ensureAmbientCapsules();
      expect(await refreshed.getMarker()).toBe('retained review history');
    });
  });
});
