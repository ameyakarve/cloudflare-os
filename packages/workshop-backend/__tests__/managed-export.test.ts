import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {expect, it} from 'vitest';

it('hides and rejects managed exports before materialization or any authored runtime', async () => {
  await runInDurableObject(env.TEST_OVERSEER.getByName(crypto.randomUUID()), async instance => {
    const impl = instance['impl'];
    impl.storage.gadgets.put({type: 'gadget', id: 3, title: 'Renamed output', created: new Date(0),
      bindingName: 'LEDGER_UI', bindings: {}, systemOutput: 'ledger',
      output: {id: 'ledger', noun: 'Ledger', plural: 'Ledgers', icon: 'table'}});
    // No code, binding or chat exists. Guards must run before trying any of those paths.
    expect(await impl.getGadgetExportFormats(3, 999)).toEqual([]);
    for (const format of ['pdf', 'png', 'csv', 'custom']) {
      await expect(impl.exportGadget(3, format, 999)).rejects.toThrow(
        'Managed outputs do not support generic Gadget exports');
    }
  });
});
