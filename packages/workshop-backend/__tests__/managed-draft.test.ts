import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';

it('attests only the canonical owner Ledger binding; compatibility, titles and content confer no identity', async () => {
  await runInDurableObject(env.TEST_OVERSEER.getByName(crypto.randomUUID()), async (instance, ctx) => {
    const impl = instance['impl'];
    impl.ownerId = 'opaque-owner';
    const gadget = {type: 'gadget' as const, id: 3, title: 'someone@example.com', created: new Date(0),
      bindingName: 'LEDGER_UI', bindings: {LEDGER: {target: 4}}, systemOutput: 'ledger' as const,
      output: {id: 'ledger', noun: 'Ledger', plural: 'Ledgers', icon: 'table' as const}};
    impl.storage.gadgets.put(gadget);
    const resource = {id: 4, resourceTitle: 'not identity',
      class: ctx.exports.LedgerEditorGatekeeper({props: {ledgerKey: 'synthetic@example.com'}}),
      systemResource: {type: 'ledger' as const, identityKey: 'synthetic@example.com'}};
    impl.storage.gatekeepers.put(resource);
    expect(impl.getManagedDraftDescriptor(3, 'opaque-owner')).toEqual({
      principalId: 'opaque-owner', workspaceId: ctx.id.toString(), outputId: '3', protocol: 1,
    });
    expect(impl.getManagedDraftDescriptor(3, 'other')).toBeUndefined();
    impl.storage.gadgets.put({...gadget, systemOutput: undefined});
    expect(impl.getManagedDraftDescriptor(3, 'opaque-owner')).toBeUndefined();
    impl.storage.gadgets.put(gadget);
    impl.storage.gatekeepers.put({...resource, systemResource: undefined});
    expect(impl.getManagedDraftDescriptor(3, 'opaque-owner')).toBeUndefined();
    impl.storage.gatekeepers.delete(4);
    expect(impl.getManagedDraftDescriptor(3, 'opaque-owner')).toBeUndefined();
  });
});
