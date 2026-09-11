import { env, RpcStub, RpcTarget } from 'cloudflare:workers';
import { doctorControlUiHash, type DoctorHumanQueue } from '@gadgets/workshop-shared/deployment-doctor-controls';
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
      async openDoctorControlsV1(key: string, queue: RpcStub<DoctorHumanQueue>, hash: string) {
        expect(hash).toBe(await doctorControlUiHash('immutable fixture, not saved source'));
        expect(key).toBe('Member@example.com');
        retained = queue.dup();
        await retained.checkActive();
        return new RpcStub(new RpcTarget());
      },
      async getDoctorControlUi() { return {jsCode:'immutable fixture, not saved source'}; },
    }});
    try {
      expect(await impl.getPrivateControlUi(3, owner)).toBeUndefined();
      await instance.optInDoctorControls(owner, 3, await doctorControlUiHash('immutable fixture, not saved source'));
      await expect(impl.getGadgetUiSession(3, undefined, undefined, 'other')).rejects.toThrow('authenticated owner');
      expect(retained).toBeUndefined();
      const bundle = await impl.getPrivateControlUi(3, owner);
      expect(bundle?.jsCode.endsWith('immutable fixture, not saved source')).toBe(true);
      expect(bundle?.jsCode).not.toBe('immutable fixture, not saved source'); // Includes the standard React/GadgetUI runtime.
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

it('actual owner host retains saved READ bundle/session by default and requires a pinned opt-in for controls', async () => {
  await runInDurableObject(env.TEST_OVERSEER.getByName('doctor-host-release'), async instance => {
    const impl = instance['impl'];
    const owner = impl.users.idFromName('release-owner').toString();
    impl.ownerId = owner;
    impl.storage.gadgets.put({type:'gadget',id:3,title:'Doctor',created:new Date(0),bindingName:'DOCTOR',bindings:{},output:{id:'doctor',noun:'Doctor',plural:'Doctor views',icon:'table'}});
    await instance.configureDoctorReadOutput(owner, 'Fixture@example.test', true);
    const saved = JSON.stringify(impl.storage.gadgets.get(3));
    const prior = {app: impl.env.MILESVAULT_DOCTOR_APP, read: impl.readGadgetFiles,
      ambient: impl.ensureAmbientCapsules, dirty: impl.markOutputsDirty, fanout: impl.joinOutputsFanout};
    let reads = 0, opens = 0;
    const source = '/* saved immutable READ fixture */';
    const newSource = '/* explicitly selected controls fixture */';
    // Suppress unrelated ambient discovery and notifications, not host bundle/session selection.
    impl.ensureAmbientCapsules = async () => {};
    impl.markOutputsDirty = () => {};
    impl.joinOutputsFanout = () => () => {};
    impl.readGadgetFiles = async () => { reads++; return new Map([['client.js', source]]); };
    const app = {
      getDoctorControlUi: async () => ({jsCode: newSource}),
      openDoctorControlsV1: async (_key: string, _queue: RpcStub<DoctorHumanQueue>, hash: string) => {
        expect(hash).toBe(await doctorControlUiHash(newSource)); opens++; return new RpcStub(new RpcTarget());
      },
    };
    Object.assign(impl.env, {MILESVAULT_DOCTOR_APP: app});
    try {
      using notify = new RpcStub(() => {});
      using host = await instance.open(owner, 'release-owner@example.test', notify);
      using client = await host.getGadget(3);
      expect((await client.getUiBundle())?.jsCode.endsWith(source)).toBe(true);
      using oldSession = await client.connectToGadget();
      expect(opens).toBe(0);
      impl.env.MILESVAULT_DOCTOR_APP = undefined;
      expect((await client.getUiBundle())?.jsCode.endsWith(source)).toBe(true);
      using absentServiceSession = await client.connectToGadget();
      expect(opens).toBe(0);
      expect(JSON.stringify(impl.storage.gadgets.get(3))).toBe(saved);
      await expect(instance.optInDoctorControls('not-owner', 3, await doctorControlUiHash(newSource))).rejects.toThrow('consent');
      await instance.optInDoctorControls(owner, 3, await doctorControlUiHash(newSource));
      await expect(client.getUiBundle()).rejects.toThrow('unavailable');
      await expect(client.connectToGadget()).rejects.toThrow('pinned Doctor controls UI');
      await expect(instance.optInDoctorControls(owner, 3, '0'.repeat(64))).rejects.toThrow('immutable');
      Object.assign(impl.env, {MILESVAULT_DOCTOR_APP: app});
      reads = 0;
      expect((await client.getUiBundle())?.jsCode.endsWith(newSource)).toBe(true);
      expect(reads).toBe(0);
      using controls = await client.connectToGadget(); expect(opens).toBe(1);
      Object.assign(impl.env, {MILESVAULT_DOCTOR_APP: {...app, getDoctorControlUi: async () => ({jsCode: 'new deployment bytes'})}});
      await expect(client.getUiBundle()).rejects.toThrow('Pinned');
      Object.assign(impl.env, {MILESVAULT_DOCTOR_APP: app});
      await client.getUiBundle();
      // An unversioned old factory cannot silently accept and ignore a hash argument.
      Object.assign(impl.env, {MILESVAULT_DOCTOR_APP: {getDoctorControlUi: app.getDoctorControlUi, openDoctorControls: async () => { throw new Error('must not select'); }}});
      await expect(client.connectToGadget()).rejects.toThrow();
    } finally {
      impl.env.MILESVAULT_DOCTOR_APP = prior.app; impl.readGadgetFiles = prior.read;
      impl.ensureAmbientCapsules = prior.ambient; impl.markOutputsDirty = prior.dirty; impl.joinOutputsFanout = prior.fanout;
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
      expect(impl.getPrivateControlResource(3, 'other')).toBeUndefined();
      expect(impl.getPrivateControlResource(3)).toBeUndefined();
      expect(impl.getPrivateControlResource(3, owner)).toBeUndefined();
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
