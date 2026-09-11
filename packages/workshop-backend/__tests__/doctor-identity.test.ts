import { env, RpcStub, RpcTarget } from 'cloudflare:workers';
import type { DoctorHumanQueue } from '@gadgets/workshop-shared/deployment-doctor-controls';
import { runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import type { OverseerDurableObject } from '../src/overseer';
import { exposeGatekeeperToAgent } from '../src/managed-output-boundary';

it('mints the human guard only through the owner browser route and revokes it on binding change and Stop', async () => {
  const overseer = env.TEST_OVERSEER.getByName('doctor-human-factory');
  await runInDurableObject(overseer, async instance => {
    const impl = instance['impl'];
    const owner = impl.users.idFromName('synthetic-human').toString();
    impl.ownerId = owner;
    impl.storage.gadgets.put({type:'gadget',id:3,title:'Doctor',created:new Date(0),bindingName:'DOCTOR',bindings:{},output:{id:'doctor',noun:'Doctor',plural:'Doctor views',icon:'table'}});
    await instance.configureDoctorReadOutput(owner, 'Member@example.com', true);
    let retained: RpcStub<DoctorHumanQueue> | undefined;
    const prior = Object.getOwnPropertyDescriptor(impl.env, 'MILESVAULT_DOCTOR_APP');
    Object.defineProperty(impl.env, 'MILESVAULT_DOCTOR_APP', {configurable:true, value:{
      async openDoctorControls(key: string, queue: RpcStub<DoctorHumanQueue>) {
        expect(key).toBe('Member@example.com');
        retained = queue.dup();
        await retained.checkActive();
        return new RpcStub(new RpcTarget());
      },
      async getDoctorControlUi() { return {jsCode:'immutable fixture, not saved source'}; },
    }});
    try {
      await expect(impl.getGadgetUiSession(3, undefined, undefined, 'other')).rejects.toThrow('authenticated owner');
      expect(retained).toBeUndefined();
      expect(await impl.getPrivateControlUi(3, owner)).toEqual({jsCode:'immutable fixture, not saved source'});
      using session = await impl.getGadgetUiSession(3, undefined, undefined, owner);
      await retained!.checkActive();
      await instance.configureDoctorReadOutput(owner, 'member@example.com');
      await expect((async()=>await retained!.checkActive())()).rejects.toThrow('identity or Stop epoch');
      await instance.configureDoctorReadOutput(owner, 'Member@example.com');
      await expect((async()=>await retained!.checkActive())()).rejects.toThrow('identity or Stop epoch');
      retained![Symbol.dispose](); retained = undefined;
      using second = await impl.getGadgetUiSession(3, undefined, undefined, owner);
      await retained!.checkActive();
      // The actual host Stop entry invalidates UI authority even if no agent is live.
      await impl.cancelAgent(999).catch(() => {});
      await expect((async()=>await retained!.checkActive())()).rejects.toThrow('identity or Stop epoch');
      expect(impl.storage.gadgets.get(3)?.bindings.DOCTOR).toBeDefined();
    } finally {
      retained?.[Symbol.dispose]();
      if (prior) Object.defineProperty(impl.env, 'MILESVAULT_DOCTOR_APP', prior);
      else Reflect.deleteProperty(impl.env, 'MILESVAULT_DOCTOR_APP');
    }
  });
});

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
      expect(() => impl.getPrivateControlResource(3, 'other')).toThrow('authenticated owner');
      expect(() => impl.getPrivateControlResource(3)).toThrow('authenticated owner');
      expect(impl.getPrivateControlResource(3, owner)?.id).toBe(id);
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
