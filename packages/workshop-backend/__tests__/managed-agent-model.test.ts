import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import type { UserDurableObject } from '../src/user.js';

declare module 'cloudflare:workers' {
  interface ProvidedEnv { TEST_USER: DurableObjectNamespace<UserDurableObject>; }
}

const modelId = '@cf/deepseek-ai/deepseek-v4-flash-0731';
const settings = {
  DEPLOYMENT_AGENT_MODEL_ID: modelId,
  CF_AI_GATEWAY: 'offline-fixture', CF_AI_GATEWAY_ACCOUNT_ID: 'a'.repeat(32),
  CF_AI_GATEWAY_PROVIDERS: 'cloudflare', CF_AI_GATEWAY_API_TOKEN: 'never-used',
};

it('enforces the deployment agent for new, existing and external chats regardless of user selection', async () => {
  const user = env.TEST_USER.getByName(crypto.randomUUID());
  await runInDurableObject(user, async instance => {
    const saved = Object.fromEntries(Object.keys(settings).map(k => [k, instance['env'][k as keyof typeof settings]]));
    Object.assign(instance['env'], settings);
    try {
      instance['storage'].preferredModel.put('old-model');
      expect(await instance.listModels()).toEqual([{ type: 'agent', id: modelId, name: 'DeepSeek Flash' }]);
      expect(await instance.getPreferredModel()).toBe(modelId);
      for (const requested of [null, 'old-model', '@cf/any-client-choice']) {
        const context = await instance.getChatContext(requested);
        expect(context.aiModel?.config).toEqual({ provider: 'cloudflare', model: modelId, apiToken: '' });
        expect(context.quickModel?.model).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
      }
      expect((await instance.getExternalMessageChatContext('old-model')).aiModel?.profile.id).toBe(modelId);
      await expect(instance.setPreferredModel('old-model')).rejects.toThrow('managed');
      await expect(instance.setPreferredModel(null)).rejects.toThrow('managed');
      await expect(instance.setQuickModel('old-model')).rejects.toThrow('managed');
      await expect(instance.deleteModel('old-model')).rejects.toThrow('managed');
      await expect(instance.addModel({ type: 'agent', id: 'custom', name: 'Custom' }, {
        provider: 'openai', model: 'custom', apiToken: 'never-used',
      })).rejects.toThrow('managed');
      instance['env'].DEPLOYMENT_AGENT_MODEL_ID = 'not-installed';
      await expect(instance.getChatContext(modelId)).rejects.toThrow('unavailable');
    } finally { Object.assign(instance['env'], saved); }
  });
});

it('uses the trusted Google display name for new accounts and legacy defaults, preserving custom names', async () => {
  const user = env.TEST_USER.getByName(crypto.randomUUID());
  expect(await user.authenticateFromCfAccess('member@example.com', true, 'अमेय Example')).toBe(true);
  expect((await user.whoami()).name).toBe('अमेय Example');
  await user.setOwnDisplayName('My chosen name');
  await user.authenticateFromCfAccess('member@example.com', true, 'Changed Google name');
  expect((await user.whoami()).name).toBe('My chosen name');

  const legacy = env.TEST_USER.getByName(crypto.randomUUID());
  await legacy.authenticateFromCfAccess('legacy@example.com', true);
  expect((await legacy.whoami()).name).toBe('legacy');
  await legacy.authenticateFromCfAccess('legacy@example.com', false, 'Legacy Member');
  expect((await legacy.whoami()).name).toBe('Legacy Member');
});
