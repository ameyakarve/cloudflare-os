import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import type { OverseerDurableObject } from '../src/overseer';

declare module 'cloudflare:workers' {
  interface ProvidedEnv { TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>; }
}

it.each(['Member@example.com', 'member@example.com', 'OpaqueCaseSensitiveKey'])(
  'provisions Vault only for its owner and preserves exact key %s', async key => {
    const overseer = env.TEST_OVERSEER.getByName(`vault-${key}`);
    await runInDurableObject(overseer, async instance => {
      const impl = instance['impl'];
      const owner = impl.users.idFromName(`vault-owner-${key}`).toString();
      impl.ownerId = owner;
      impl.storage.gadgets.put({type: 'gadget', id: 3, title: 'Vault', created: new Date(0),
        bindingName: 'VAULT', bindings: {}, output: {id: 'vault', noun: 'Vault', plural: 'Vaults', icon: 'table'}});
      await instance.configureVaultReadOutput('other', key);
      expect(impl.storage.gadgets.get(3)!.bindings).toEqual({});
      await instance.configureVaultReadOutput(owner, key);
      expect(impl.storage.gadgets.get(3)!.bindings).toEqual({}); // No historical retrofit.
      await expect(instance.configureVaultReadOutput(owner, ' invalid ', true)).rejects.toThrow();
      await instance.configureVaultReadOutput(owner, key, true);
      const id = impl.storage.gadgets.get(3)!.bindings.VAULT.target;
      expect(impl.storage.gatekeepers.get(id)!.systemResource).toEqual({type: 'vaultRead', identityKey: key});
      expect(impl.storage.prohibitAllSharing.get()).toBe(true);
      expect(() => impl.assertGadgetMutable(3)).toThrow();
      expect(() => impl.assertWorkspaceMutable()).toThrow();
      expect(await impl.getGadgetExportFormats(3)).toEqual([]);
      await expect(impl.exportGadget(3, 'pdf')).rejects.toThrow('cannot be exported');
      await instance.configureVaultReadOutput(owner, key);
      expect(impl.storage.gadgets.get(3)!.bindings.VAULT.target).toBe(id);
    });
  },
);
