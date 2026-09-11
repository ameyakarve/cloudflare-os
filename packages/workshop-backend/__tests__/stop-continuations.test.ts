import { env, RpcStub } from 'cloudflare:workers';
import { abortAllDurableObjects, runInDurableObject } from 'cloudflare:test';
import { expect, it, vi } from 'vitest';
import { keyString } from '@gadgets/typed-storage';

const author = {type: 'user' as const, id: 'synthetic', name: 'Synthetic'};
const model = {profile: {type: 'agent' as const, id: 'fixture', name: 'Fixture'},
  config: {provider: 'openai' as const, model: 'gpt-4.1', apiToken: 'never-used'}};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return {promise, resolve};
}

// Real session decision/resume methods and real SQLite. Only identity/model/admission and
// unrelated workspace-open side effects are synthetic; no model/provider is constructed.
it.each(['approval', 'connection'] as const)('%s continuation: Stop, await races, replacement, legacy and positive control', async kind => {
  await runInDurableObject(env.TEST_OVERSEER.getByName(crypto.randomUUID()), async instance => {
    const impl = instance['impl'];
    const userId = impl.users.idFromName('synthetic-continuation-owner').toString();
    impl.ownerId = userId;
    const user = impl.users.get(impl.users.idFromString(userId));
    const getUser = vi.spyOn(impl.users, 'get').mockReturnValue(user);
    const whoami = vi.spyOn(user, 'whoami').mockResolvedValue(author);
    const context = vi.spyOn(user, 'getChatContext').mockResolvedValue({profile: author, aiModel: model});
    const capsules = vi.spyOn(impl, 'ensureAmbientCapsules').mockResolvedValue();
    const outputs = vi.spyOn(impl, 'markOutputsDirty').mockImplementation(() => {});
    const bump = vi.spyOn(impl, 'bumpLastActive').mockImplementation(() => {});
    const fanout = vi.spyOn(impl, 'joinOutputsFanout').mockReturnValue(() => {});
    const apply = vi.spyOn(impl, 'applyPendingAction').mockImplementation(async record => {
      impl.storage.actions.put({...record, state: 'approved'});
    });
    const drain = vi.spyOn(impl, 'drainAutoApprovals').mockResolvedValue();
    const preparation = vi.spyOn(impl, 'waitForChatMessagePreparation').mockReturnValue(undefined);
    // Count admission at the actual startAgent boundary without entering a provider turn.
    const start = vi.spyOn(impl, 'startAgent').mockImplementation(() => {});
    using closed = new RpcStub(() => {});
    const session = await instance.open(userId, author.id, closed);
    let sequence = 0;
    function seed(id: string | undefined = 'old') {
      // Snapshot before writes: index maintenance starts another native kv.list iterator.
      const messages = [...impl.storage.chats.list()];
      const actions = [...impl.storage.actions.list()];
      for (const msg of messages) impl.storage.chats.delete(`${keyString(msg.chatId)}.${keyString(msg.sequence)}`);
      for (const action of actions) impl.storage.actions.delete(action.id);
      impl.storage.activeAgents.delete(7);
      impl.storage.agentContinuations.put({chatId: 7, id: 'old'});
      impl.storage.chatMeta.put({id: 7, title: 'Synthetic', started: new Date(), lastActive: new Date()});
      if (kind === 'approval') {
        impl.storage.actions.put({id: 1, gatekeeperId: 1, caller: {from: 'agent', chatId: 7},
          createdAt: new Date(), state: 'pending', type: 'action', action: 1,
          description: {title: 'Synthetic action', description: 'Synthetic fixture', implementsRevert: false, awaitDecision: true}, continuationId: id});
        impl.storage.chats.put({chatId: 7, sequence: ++sequence, timestamp: impl.getChatTimestamp(), author: model.profile,
          type: 'action', actionId: 1});
      } else {
        impl.storage.chats.put({chatId: 7, sequence: ++sequence, timestamp: impl.getChatTimestamp(), author: model.profile,
          type: 'connectionRequest', requestId: '7:synthetic', vendorId: 'synthetic', vendorName: 'Synthetic',
          resourceTitle: 'Synthetic', reason: 'Fixture', bindingName: 'FIXTURE', state: 'pending', continuationId: id});
      }
      context.mockClear(); start.mockClear();
    }
    const decide = () => kind === 'approval' ? session.approveAction(1)
      : session.acceptConnectionRequest('7:synthetic', {gatekeeperId: 1});
    try {
      seed();
      const orphan = impl.storage.chatMeta.get(7)!;
      orphan.activeAgent = model.profile; impl.storage.chatMeta.put(orphan);
      await impl.cancelAgent(7); // suspended: no live context AND no active row
      expect(impl.storage.chatMeta.get(7)?.activeAgent).toBeUndefined();
      await decide();
      expect(context).not.toHaveBeenCalled();
      expect(start).not.toHaveBeenCalled();
      if (kind === 'approval') expect(impl.storage.actions.get(1)?.state).toBe('approved');

      seed();
      await impl.cancelAgent(7);
      impl.storage.agentContinuations.put({chatId: 7, id: 'new'});
      await decide();
      expect(context).not.toHaveBeenCalled();
      expect(start).not.toHaveBeenCalled();
      expect(impl.storage.agentContinuations.get(7)?.id).toBe('new');

      seed();
      // Missing ownership is legacy/ambiguous, not authority over the latest chat row.
      if (kind === 'approval') {
        const action = impl.storage.actions.get(1)!;
        delete action.continuationId; impl.storage.actions.put(action);
      } else {
        const msg = [...impl.storage.chats.list()][0];
        delete msg.continuationId; impl.storage.chats.put(msg);
      }
      await decide();
      expect(context).not.toHaveBeenCalled();
      expect(start).not.toHaveBeenCalled();

      if (kind === 'approval') {
        seed();
        const entered = deferred(), release = deferred();
        apply.mockImplementationOnce(async record => {
          entered.resolve(); await release.promise;
          impl.storage.actions.put({...record, state: 'approved'});
        });
        const pending = decide();
        await entered.promise;
        await impl.cancelAgent(7);
        impl.storage.agentContinuations.put({chatId: 7, id: 'new'});
        release.resolve(); await pending;
        expect(impl.storage.actions.get(1)?.state).toBe('approved');
        expect(context).not.toHaveBeenCalled();
        expect(start).not.toHaveBeenCalled();
      }

      for (const point of ['preparation', 'model', 'late-preparation'] as const) {
        seed();
        const entered = deferred(), release = deferred();
        if (point === 'model') {
          context.mockImplementationOnce(async () => {
            entered.resolve(); await release.promise; return {profile: author, aiModel: model};
          });
        } else {
          if (point === 'late-preparation') preparation.mockReturnValueOnce(undefined);
          preparation.mockImplementationOnce(() => { entered.resolve(); return release.promise; });
        }
        const pending = decide();
        await Promise.race([entered.promise, pending.then(() => { throw new Error(`Did not enter ${point}`); })]);
        await impl.cancelAgent(7);
        // A newer completed execution must not make the old pending await eligible again.
        impl.storage.agentContinuations.put({chatId: 7, id: 'new'});
        release.resolve();
        await pending;
        expect(start).not.toHaveBeenCalled();
        expect(impl.storage.chatMeta.get(7)?.activeAgent).toBeUndefined();
      }

      seed();
      await decide();
      expect(context).toHaveBeenCalledTimes(1);
      expect(start).toHaveBeenCalledWith(7, model, author, userId, false, false, {id: 'old'});

      // Explicit user Send/Retry are different authority. Exercise the real admission/cleanup
      // boundary, rejecting the synthetic usage lookup before any model or transport exists.
      start.mockRestore();
      const admission = vi.spyOn(impl, 'newUsageScope').mockRejectedValue(new Error('synthetic admission end'));
      const errors = vi.spyOn(impl, 'postAgentErrorMessage').mockImplementation(() => {});
      const materialize = vi.spyOn(impl, 'materializeChatChanges').mockReturnValue(undefined);
      const reconcile = vi.spyOn(impl, 'reconcilePendingGadgets').mockResolvedValue();
      const analytics = vi.spyOn(impl, 'recordGadgetAnalytics').mockImplementation(() => {});
      try {
        seed();
        impl.startAgent(7, model, author, userId, false, false, {id: undefined});
        expect(admission).not.toHaveBeenCalled();
        await decide();
        expect(impl.storage.agentContinuations.get(7)?.id).not.toBe('old');
        await impl.waitForAllAgentsToComplete();
        seed();
        await impl.cancelAgent(7);
        await session.retryAgent(7, 'fixture');
        const retryId = impl.storage.agentContinuations.get(7)?.id;
        expect(retryId).toBeTruthy();
        expect(retryId).not.toBe('old');
        await impl.waitForAllAgentsToComplete();
        await impl.cancelAgent(7);
        await session.sendChatMessage(7, 'Synthetic new turn', 'fixture');
        const sendId = impl.storage.agentContinuations.get(7)?.id;
        expect(sendId).toBeTruthy();
        expect(sendId).not.toBe(retryId);
        await impl.waitForAllAgentsToComplete();
        await decide(); // actual old request after both real new-turn admissions/cleanups
        expect(admission).toHaveBeenCalledTimes(3);
        expect(impl.storage.agentContinuations.get(7)?.id).toBe(sendId);
        expect(impl.canContinueAgent(7, 'old')).toBe(false);
      } finally {
        for (const mock of [admission, errors, materialize, reconcile, analytics]) mock.mockRestore();
      }
    } finally {
      session[Symbol.dispose]();
      for (const mock of [getUser, whoami, context, capsules, outputs, bump, fanout, apply, drain, preparation, start]) mock.mockRestore();
    }
  });
});

it('suspended Stop revokes continuation authority across actual SQLite reopen, not just the active row', async () => {
  const name = crypto.randomUUID();
  await runInDurableObject(env.TEST_OVERSEER.getByName(name), async instance => {
    const impl = instance['impl'];
    impl.storage.agentContinuations.put({chatId: 7, id: 'suspended'});
    await impl.cancelAgent(7);
    expect(impl.storage.activeAgents.get(7)).toBeUndefined();
  });
  await abortAllDurableObjects();
  await runInDurableObject(env.TEST_OVERSEER.getByName(name), async instance => {
    const impl = instance['impl'];
    expect(impl.canContinueAgent(7, 'suspended')).toBe(false);
    impl.storage.agentContinuations.put({chatId: 7, id: 'new'});
    expect(impl.canContinueAgent(7, 'suspended')).toBe(false);
    expect(impl.canContinueAgent(7, 'new')).toBe(true);
  });
});

it('creation captures queue and connection ownership before awaits, never the replacement at resolution', async () => {
  await runInDurableObject(env.TEST_OVERSEER.getByName(crypto.randomUUID()), async instance => {
    const impl = instance['impl'];
    impl.storage.agentContinuations.put({chatId: 7, id: 'creating'});
    impl.storage.chatMeta.put({id: 7, title: 'Synthetic', started: new Date(), lastActive: new Date()});
    const userId = impl.users.idFromName('synthetic-creation-owner').toString();
    impl.ownerId = userId;
    const user = impl.users.get(impl.users.idFromString(userId));
    const getUser = vi.spyOn(impl.users, 'get').mockReturnValue(user);
    const entered = deferred(), release = deferred();
    const vendors = vi.spyOn(user, 'listGatekeeperVendors').mockImplementation(async () => {
      entered.resolve(); await release.promise;
      return [{id: 'fixture', description: {displayName: 'Fixture'},
        supportedResources: [{title: 'Fixture', urlPattern: 'https://*'}]}];
    });
    const access = vi.spyOn(impl, 'checkDeploymentAccess').mockResolvedValue();
    const charge = vi.spyOn(impl, 'chargeUsage').mockResolvedValue();
    const usable = vi.spyOn(impl, 'assertGatekeeperUsable').mockImplementation(() => {});
    const bump = vi.spyOn(impl, 'bumpLastActive').mockImplementation(() => {});
    // Derive the queue type from the real contract, not a mirrored test RPC interface.
    let queue!: import('capnweb').RpcStub<import('@gadgets/workshop-shared/gatekeeper').ApprovalQueue>;
    const facet = vi.spyOn(impl, 'getGatekeeperFacet').mockReturnValue({
      startSession: async (value: typeof queue) => { queue = value; return {}; },
    });
    try {
      await impl.startGatekeeperSession({type: 'gatekeeper', id: 1}, {from: 'agent', chatId: 7});
      const pending = impl.requestConnection(7, {vendorId: 'fixture', reason: 'Synthetic', bindingName: 'FIXTURE'});
      await entered.promise;
      await impl.cancelAgent(7);
      impl.storage.agentContinuations.put({chatId: 7, id: 'replacement'});
      release.resolve();
      expect((await pending).requested).toBe(false);
      expect(impl.consumeCapturedConnectionRequests(7)).toEqual([]);
      // Old queue can still submit its canonical action, but cannot authorize replacement inference.
      await queue.submitAction(1, {title: 'Synthetic', description: 'Synthetic fixture', implementsRevert: false, awaitDecision: true});
      expect([...impl.storage.actions.list()][0].continuationId).toBe('creating');
      expect(impl.consumeCapturedActions(7)).toBeUndefined();
      expect((await impl.requestConnection(7, {vendorId: 'fixture', reason: 'Synthetic', bindingName: 'FIXTURE'})).requested).toBe(true);
      impl.addChatMessages(7, model.profile, impl.consumeCapturedConnectionRequests(7));
      const request = [...impl.storage.chats.list()].find(msg => msg.type === 'connectionRequest');
      expect(request?.continuationId).toBe('replacement');
      await impl.cancelAgent(7);
      expect(impl.canContinueAgent(7, request?.continuationId)).toBe(false);
    } finally {
      release.resolve();
      queue?.[Symbol.dispose]();
      for (const mock of [getUser, vendors, access, charge, usable, bump, facet]) mock.mockRestore();
    }
  });
});
