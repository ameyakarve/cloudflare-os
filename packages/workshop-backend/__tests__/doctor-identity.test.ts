import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import type { OverseerDurableObject } from '../src/overseer';
import { exposeGatekeeperToAgent } from '../src/managed-output-boundary';

declare module 'cloudflare:workers' {
  interface ProvidedEnv { TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>; }
}

it.each(['Member@example.com', 'member@example.com', 'OpaqueCaseSensitiveKey'])(
  'provisions Doctor only for its owner and preserves exact key %s', async key => {
    const overseer = env.TEST_OVERSEER.getByName(`doctor-${key}`);
    await runInDurableObject(overseer, async instance => {
      const impl = instance['impl'];
      const owner = impl.users.idFromName(`doctor-owner-${key}`).toString();
      impl.ownerId = owner;
      impl.storage.gadgets.put({type:'gadget',id:3,title:'Doctor',created:new Date(0),bindingName:'DOCTOR',bindings:{},output:{id:'doctor',noun:'Doctor',plural:'Doctor views',icon:'table'}});
      await instance.configureDoctorReadOutput('other',key,true);
      expect(impl.storage.gadgets.get(3)!.bindings).toEqual({});
      await instance.configureDoctorReadOutput(owner,key);
      expect(impl.storage.gadgets.get(3)!.bindings).toEqual({}); // No retrofit from forged metadata.
      await expect(instance.configureDoctorReadOutput(owner,' invalid ',true)).rejects.toThrow();
      await instance.configureDoctorReadOutput(owner,key,true);
      const id=impl.storage.gadgets.get(3)!.bindings.DOCTOR.target;
      expect(impl.storage.gatekeepers.get(id)!.systemResource).toEqual({type:'doctorRead',identityKey:key});
      expect(exposeGatekeeperToAgent(impl.storage.gatekeepers.get(id))).toBe(false);
      expect(impl.storage.prohibitAllSharing.get()).toBe(true);
      expect(()=>impl.assertGadgetMutable(3)).toThrow();
      expect(()=>impl.assertWorkspaceMutable()).toThrow();
      expect(await impl.getGadgetExportFormats(3)).toEqual([]);
      await expect(impl.exportGadget(3,'pdf')).rejects.toThrow('cannot be exported');
      await instance.configureDoctorReadOutput(owner,key);
      expect(impl.storage.gadgets.get(3)!.bindings.DOCTOR.target).toBe(id);
      await instance.configureDoctorReadOutput(owner,'ChangedCaseKey');
      expect(impl.storage.gadgets.get(3)!.bindings.DOCTOR.target).toBe(id);
      expect(impl.storage.gatekeepers.get(id)!.systemResource).toEqual({type:'doctorRead',identityKey:'ChangedCaseKey'});
    });
  },
);
