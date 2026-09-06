import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import type { OverseerDurableObject } from '../src/overseer';

declare module 'cloudflare:workers' {
  interface ProvidedEnv { TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>; }
}

it.each(['123456789012345678', 'OpaqueCaseSensitiveKey', 'Member@example.com'])(
  'keeps the exact Points key %s and refreshes the same workpiece', async key => {
    const overseer = env.TEST_OVERSEER.getByName(`points-key-${key}`);
    await runInDurableObject(overseer, async instance => {
      const impl = instance['impl'];
      const owner = impl.users.idFromName(`points-owner-${key}`).toString();
      impl.ownerId = owner;
      impl.storage.gadgets.put({type: 'gadget', id: 3, title: 'Points', created: new Date(0),
        bindingName: 'POINTS', bindings: {}, output: {id: 'paths-to-points', noun: 'Path', plural: 'Paths', icon: 'flowArrow'},
      });
      expect(await instance.configureMilesVaultPointsOutput('other', key)).toBe(false);
      await expect(instance.configureMilesVaultPointsOutput(owner, ' invalid key ')).rejects.toThrow();
      expect(await instance.configureMilesVaultPointsOutput(owner, 'legacy@example.com')).toBe(true);
      const id = impl.storage.gadgets.get(3)!.bindings.LEDGER.target;
      expect(await instance.configureMilesVaultPointsOutput(owner, key)).toBe(true);
      expect(impl.storage.gadgets.get(3)!.bindings.LEDGER.target).toBe(id);
      expect(impl.storage.gatekeepers.get(id)!.systemResource).toEqual({type: 'ledgerHoldings', identityKey: key});
      expect(impl.storage.prohibitAllSharing.get()).toBe(true);
    });
  },
);
