import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { afterEach, expect, it, vi } from 'vitest';
import type { OverseerDurableObject } from '../src/overseer.js';
import type { UserDurableObject } from '../src/user.js';
import { completeText } from '../src/ai-invoke.js';

vi.mock('../src/ai-invoke.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/ai-invoke.js')>(),
  completeText: vi.fn(),
}));

declare module 'cloudflare:workers' {
  interface ProvidedEnv {
    TEST_USER: DurableObjectNamespace<UserDurableObject>;
    TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>;
  }
}

afterEach(() => vi.restoreAllMocks());
const author = { type: 'user' as const, id: 'title@example.com', name: 'Title test' };
const quickModel = { provider: 'openai' as const, model: 'gpt-4.1', apiToken: 'never-used' };
const request = 'Which cards are good for tax payments?';

async function fixture() {
  const owner = env.TEST_USER.getByName(crypto.randomUUID());
  const workspace = env.TEST_OVERSEER.getByName(crypto.randomUUID());
  await owner.newGadget(workspace.id.toString(), 'Untitled Workspace');
  await runInDurableObject(workspace, instance => {
    const impl = instance['impl'];
    impl.ownerId = owner.id.toString();
    impl.users = env.TEST_USER;
    impl.storage.chatMeta.put({ id: 0, title: 'New Chat', started: new Date(), lastActive: new Date() });
  });
  return { owner, workspace };
}

it('names the first chat and workspace without a quick model or any model/usage call', async () => {
  const { owner, workspace } = await fixture();
  await runInDurableObject(workspace, async instance => {
    const impl = instance['impl'];
    const usage = vi.spyOn(impl, 'newUsageScope').mockRejectedValue(new Error('must not open usage'));
    const title = vi.spyOn(impl, 'generateThreadTitle');
    expect(await impl.newChat(owner, { profile: author }, `  ${request}\n  `)).toBe(0);
    expect(title).toHaveBeenCalledWith(0, request, undefined, author);
    await title.mock.results[0].value;
    expect(usage).not.toHaveBeenCalled();
    expect(impl.storage.chatMeta.get(0)?.title).toBe(request);
    expect(impl.storage.title.get()).toBe(request);
  });
  expect((await owner.getGadget(workspace.id.toString()))?.title).toBe(request);
});

it.each(['success', 'blank', 'failure'] as const)('uses an available quick model, with safe fallback on %s', async mode => {
  const { owner, workspace } = await fixture();
  await runInDurableObject(workspace, async instance => {
    const impl = instance['impl'];
    vi.spyOn(impl, 'newUsageScope').mockResolvedValue(undefined);
    const call = vi.mocked(completeText);
    if (mode === 'failure') call.mockRejectedValueOnce(new Error('offline fixture failure'));
    else call.mockResolvedValueOnce(mode === 'blank' ? '  ' : ' Indian Tax Cards \n');
    await impl.generateThreadTitle(0, request, quickModel, author);
    expect(call).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ maxTokens: 128 }));
    expect(impl.storage.title.get()).toBe(mode === 'success' ? 'Indian Tax Cards' : request);
  });
  expect((await owner.getGadget(workspace.id.toString()))?.title).toBe(mode === 'success' ? 'Indian Tax Cards' : request);
});

it('does not let a delayed completion overwrite manual chat or workspace titles', async () => {
  const { workspace } = await fixture();
  await runInDurableObject(workspace, async instance => {
    const impl = instance['impl'];
    vi.spyOn(impl, 'newUsageScope').mockResolvedValue(undefined);
    vi.mocked(completeText).mockImplementationOnce(async () => {
      const meta = impl.storage.chatMeta.get(0)!;
      impl.storage.chatMeta.put({ ...meta, title: 'My chat title' });
      impl.storage.title.put('My workspace title');
      return 'Generated title';
    });
    await impl.generateThreadTitle(0, request, quickModel, author);
    expect(impl.storage.chatMeta.get(0)?.title).toBe('My chat title');
    expect(impl.storage.title.get()).toBe('My workspace title');
  });
});

it('keeps specialist child labels and existing workspace names; bounds request-derived titles', async () => {
  const { owner, workspace } = await fixture();
  await runInDurableObject(workspace, async instance => {
    const impl = instance['impl'];
    impl.storage.title.put('My workspace title');
    impl.storage.chatMeta.put({ id: 1, title: 'Card Advice', spawnerName: 'Card Advice', started: new Date(), lastActive: new Date() });
    await impl.generateThreadTitle(1, request, undefined, author);
    expect(impl.storage.chatMeta.get(1)?.title).toBe('Card Advice');
    await impl.generateThreadTitle(0, 'Tax cards '.repeat(100), undefined, author);
    expect(impl.storage.chatMeta.get(0)?.title).toHaveLength(80);
    expect(impl.storage.title.get()).toBe('My workspace title');
  });
  expect((await owner.getGadget(workspace.id.toString()))?.title).toBe('Untitled Workspace'); // No title update was sent.
});
