import type { ApprovalQueue, GitCache } from "@gadgets/workshop-shared/gatekeeper";
import type { LanguageModelGatekeeper } from "../src/ai-models.js";
import { describe, expect, it } from "vitest";
import { RpcStub, RpcTarget } from "cloudflare:workers";
import { createAssistantMessageEventStream, type Api, type AssistantMessage, type Model, type StreamFunction, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { DeploymentUsage, DeploymentUsageRun, UsageGrant } from "@gadgets/workshop-shared/deployment-usage";
import { UsageScope, DeploymentUsageError } from "../src/deployment-usage.js";
import { streamWithUsage } from "../src/model-usage.js";
import { zeroUsage } from "../src/ai-invoke.js";
import { getModel } from "../src/ai-models.js";

class FixtureRun extends RpcTarget implements DeploymentUsageRun {
  reservations: DeploymentUsage[] = [];
  settlements: number[] = [];
  finished = false;
  refuse = false;
  refuseResource?: keyof DeploymentUsage;
  constructor(readonly expiresAt = Date.now() + 10_000) { super(); }
  async getGrant(): Promise<UsageGrant> { return {allowed: true, runId: crypto.randomUUID(), expiresAt: this.expiresAt}; }
  async reserve(usage: DeploymentUsage) {
    if (this.refuse || this.finished || this.expiresAt <= Date.now()) throw new DeploymentUsageError("run_limit", this.refuseResource);
    this.reservations.push(usage);
    return crypto.randomUUID();
  }
  async settleTokens(_id: string, tokens: number) { this.settlements.push(tokens); }
  async finish() { this.finished = true; }
}
const model: Model<Api> = {api: "openai-completions", provider: "openai", id: "fixture", name: "Fixture",
  baseUrl: "https://model.test", input: ["text"], reasoning: false, contextWindow: 1000, maxTokens: 100,
  cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}};
const context = {messages: [{role: "user" as const, content: "Hello", timestamp: 0}]};
function message(tokens: number): AssistantMessage {
  return {role: "assistant", api: model.api, provider: model.provider, model: model.id,
    content: [{type: "text", text: "Hello"}], usage: {...zeroUsage(), totalTokens: tokens}, stopReason: "stop", timestamp: 0};
}
const fakeProvider = (tokens = 10, attempts = 1): StreamFunction<Api, SimpleStreamOptions> => (model, _context, options) => {
  const stream = createAssistantMessageEventStream();
  void (async () => {
    for (let i = 0; i < attempts; i++) await options!.fetch!(model.baseUrl);
    stream.push({type: "done", reason: "stop", message: message(tokens)});
  })().catch(error => stream.push({type: "error", reason: "error", error: {...message(0), stopReason: "error", errorMessage: String(error)}}))
    .finally(() => stream.end());
  return stream;
};

describe("native scoped inference budgets", () => {
  it("reserves every actual dispatch before transport and settles only the final verified usage", async () => {
    const fixture = new FixtureRun();
    await using scope = await UsageScope.open(new RpcStub(fixture));
    let fetches = 0;
    const result = await streamWithUsage(fakeProvider(20, 2), model, context, {fetch: async () => {
      expect(fixture.reservations).toHaveLength(++fetches);
      return new Response("");
    }}, scope).result();
    expect(result.stopReason).toBe("stop");
    expect(fixture.reservations).toEqual(Array.from({length: 2}, () => ({tokens: 1100, modelRequests: 1, externalRequests: 1})));
    expect(fixture.settlements).toEqual([20]);
  });

  it("refuses exhausted scope before any provider dispatch", async () => {
    const fixture = new FixtureRun(); fixture.refuse = true; fixture.refuseResource = "tokens";
    await using scope = await UsageScope.open(new RpcStub(fixture));
    let fetches = 0;
    const result = await streamWithUsage(fakeProvider(), model, context, {fetch: async () => {
      fetches++; return new Response("");
    }}, scope).result();
    expect(result.stopReason).toBe("error"); expect(fetches).toBe(0);
    expect(result.errorMessage).toContain("Resource: tokens");
    expect(result.errorMessage).not.toMatch(/429|retry later/i);
  });

  it("distinguishes the model deadline from a provider rate limit", async () => {
    const controller = new AbortController();
    controller.abort(new DeploymentUsageError("request_deadline"));
    await using scope = await UsageScope.open(new RpcStub(new FixtureRun()));
    const result = await streamWithUsage(fakeProvider(), model, context, {signal: controller.signal}, scope).result();
    expect(result.errorMessage).toContain("60-second deadline");
    expect(result.errorMessage).not.toMatch(/429|retry later/i);
    const provider = await streamWithUsage(fakeProvider(), model, context, {fetch: async () => {
      throw new Error("429 Too Many Requests");
    }}, scope).result();
    expect(provider.errorMessage).toContain("429 Too Many Requests");
    expect(new DeploymentUsageError("daily_limit", "modelRequests").message).toContain("Retrying now will not help");
  });

  it("keeps the full token reservation when usage is missing", async () => {
    const fixture = new FixtureRun();
    await using scope = await UsageScope.open(new RpcStub(fixture));
    await streamWithUsage(fakeProvider(0), model, context, {fetch: async () => new Response("")}, scope).result();
    expect(fixture.reservations).toHaveLength(1); expect(fixture.settlements).toEqual([]);
  });

  it("aborts stalled inference at the run deadline and completes the caller's stream", async () => {
    const fixture = new FixtureRun(Date.now() + 100);
    await using scope = await UsageScope.open(new RpcStub(fixture));
    let transportAborted = false;
    const result = await streamWithUsage(fakeProvider(), model, context, {fetch: async (_input, init) => {
      return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => {
        transportAborted = true; reject(init!.signal!.reason);
      }, {once: true}));
    }}, scope).result();
    expect(result.stopReason).toBe("error"); expect(transportAborted).toBe(true);
    expect(result.errorMessage).toContain("expired");
    expect(result.errorMessage).not.toContain("429");
    expect(fixture.settlements).toEqual([]);
  });

  it("disposing a borrowed tool scope cannot finish its parent agent run", async () => {
    const fixture = new FixtureRun();
    await using parent = await UsageScope.open(new RpcStub(fixture));
    { await using child = await UsageScope.open(new RpcStub(parent.borrow())); await child.reserve({capabilityCalls: 1}); }
    expect(fixture.finished).toBe(false);
    await parent.reserve({capabilityCalls: 1});
  });

  it("fails closed when required inference has no quota authority", async () => {
    const handle = getModel({DEPLOYMENT_USAGE_REQUIRED: "true"} as Cloudflare.Env,
      {provider: "openai", model: "gpt-4.1", apiToken: "fixture"}, {type: "user", id: "fixture", name: "Fixture"});
    let fetches = 0;
    const result = await handle.stream(handle.model, context, {fetch: async () => {
      fetches++; return new Response("");
    }}).result();
    expect(result.stopReason).toBe("error"); expect(fetches).toBe(0);
  });

  it("reserves the Google adapter before invocation and disables its internal retries", async () => {
    const fixture = new FixtureRun();
    await using scope = await UsageScope.open(new RpcStub(fixture));
    const provider: StreamFunction<Api, SimpleStreamOptions> = (_model, _context, options) => {
      expect(fixture.reservations).toHaveLength(1);
      expect(options!.maxRetries).toBe(0); expect(options!.fetch).toBeUndefined();
      const stream = createAssistantMessageEventStream();
      stream.push({type: "done", reason: "stop", message: message(10)}); stream.end(); return stream;
    };
    expect((await streamWithUsage(provider, {...model, api: "google-generative-ai"}, context, {}, scope).result()).stopReason).toBe("stop");
  });
});

it("uses the stored exact User DO identity and resumes only the supplied existing grant", async () => {
  const {env} = await import("cloudflare:workers");
  const {runInDurableObject} = await import("cloudflare:test");
  const user = env.TEST_USER.getByName(crypto.randomUUID());
  await user.authenticateFromCfAccess("member@example.com", true);
  await user.bindDeploymentIdentity({subject: "member@example.com", storageKey: "Member@example.com"});
  await runInDurableObject(user, async (instance, ctx) => {
    const oldPolicy = instance["env"].DEPLOYMENT_USAGE_POLICY;
    const id = crypto.randomUUID(), expiresAt = Date.now() + 10_000;
    instance["env"].DEPLOYMENT_USAGE_POLICY = ctx.exports.IdentityTestUsagePolicy({props: {key: "Member@example.com", expiresAt, resumeId: id}});
    try {
      const raw = await instance.beginDeploymentUsageRun(id);
      expect(raw).toBeDefined();
      await using scope = await UsageScope.open(new RpcStub(raw!));
      expect(scope.grant.runId).toBe(id); expect(scope.grant.expiresAt).toBe(expiresAt);
      const receipt = await scope.reserve({modelRequests: 1});
      await scope.run.settleTokens(receipt, 20);
      let settlementError = "";
      try { await scope.run.settleTokens(crypto.randomUUID(), 0); } catch (error) { settlementError = String(error); }
      expect(settlementError).toContain("unavailable");
      await expect(instance.beginDeploymentUsageRun(crypto.randomUUID())).rejects.toThrow("OS allowance expired");
    } finally { instance["env"].DEPLOYMENT_USAGE_POLICY = oldPolicy; }
  });
}, 15_000);

it("charges schedule starts and refuses retained callbacks, observations and writes after expiry", async () => {
  const {env} = await import("cloudflare:workers");
  const {runInDurableObject} = await import("cloudflare:test");
  const user = env.TEST_USER.getByName(crypto.randomUUID());
  await user.authenticateFromCfAccess("schedule@example.com", true);
  await user.bindDeploymentIdentity({subject: "schedule@example.com", storageKey: "Schedule@example.com"});
  const charges: DeploymentUsage[] = [];
  const policy = {
    async beginRun(key: string, runId: string) {
      if (key !== "Schedule@example.com") return {allowed: false as const, reason: "unavailable" as const};
      return {allowed: true as const, runId, expiresAt: Date.now() + 150};
    },
    async reserve(_key: string, _run: string, _id: string, usage: DeploymentUsage) {
      if (usage.scheduledStarts && charges.some(charge => charge.scheduledStarts)) return {allowed: false as const, reason: "daily_limit" as const};
      charges.push(usage); return {allowed: true as const};
    },
    async settleTokens() {}, async finishRun() {},
  };
  await runInDurableObject(user, instance => { Object.assign(instance["env"], {DEPLOYMENT_USAGE_POLICY: policy}); });
  try {
    await runInDurableObject(env.TEST_OVERSEER.getByName(crypto.randomUUID()), async (instance, ctx) => {
      const impl = instance["impl"], oldRequired = instance["env"].DEPLOYMENT_USAGE_REQUIRED,
          oldBlueprints = instance["env"].BLUEPRINTS;
      instance["env"].DEPLOYMENT_USAGE_REQUIRED = "true";
      Object.assign(instance["env"], {BLUEPRINTS: {get: async () => null}});
      impl.ownerId = user.id.toString(); impl.users = env.TEST_USER;
      impl.storage.gatekeepers.put({id: 1, resourceTitle: "Schedule fixture",
        class: ctx.exports.IdentityTestGatekeeper({props: {subject: "schedule@example.com", storageKey: "Schedule@example.com"}}),
        creationSpec: {type: "ambient", vendorId: "scheduler", accountId: 1}});
      const callback = ctx.exports.IdentityTestHook({});
      type Hook = Parameters<typeof impl.storage.boundHooks.put>[0];
      impl.storage.boundHooks.put({id: 1, actionId: 1, gatekeeperId: 1, vendorId: "scheduler", enabled: true,
        description: {title: "Fixture", description: "No external effects"},
        callback: callback as unknown as Hook["callback"], controller: callback});
      try {
        // A user observation receives a remote User DO stub, unlike the local borrowed target
        // used by an agent/hook. Both must survive the same native scope admission path.
        await impl.chargeUsage({from: "user"}, {capabilityCalls: 1});
        const firing = await instance.startHook(1);
        using nativeQueue = new RpcStub(firing.approvalQueue);
        using budget = await nativeQueue.getUsageBudget();
        expect((await budget!.getGrant()).allowed).toBe(true);
        // The native hook is the fixture's deliver method; the runtime intentionally returns a
        // vendor-neutral RpcTarget because hook method names are vendor-defined.
        const target = firing.callback as unknown as Pick<import("./deployment-identity-worker.js").IdentityTestHook, "deliver">;
        expect(await target.deliver()).toBe("delivered");
        expect(charges.some(charge => charge.scheduledStarts === 1)).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 180));
        let refused = "";
        try { await target.deliver(); } catch (error) { refused = String(error); }
        expect(refused).toMatch(/expired|deadline/);
        await expect(firing.approvalQueue.authorizeObservation({title: "Fixture", description: "Read"})).rejects.toThrow();
        await expect(firing.approvalQueue.submitAction(2, {title: "Fixture", description: "Write", implementsRevert: false})).rejects.toThrow();
        await expect(instance.startHook(1)).rejects.toThrow();
        expect([...impl.storage.actions.list()]).toHaveLength(0);
        firing.callback[Symbol.dispose]();
        new RpcStub(firing.approvalQueue)[Symbol.dispose]();
      } finally { instance["env"].DEPLOYMENT_USAGE_REQUIRED = oldRequired; instance["env"].BLUEPRINTS = oldBlueprints; }
    });
  } finally { await runInDurableObject(user, instance => { delete instance["env"].DEPLOYMENT_USAGE_POLICY; }); }
});

it("revalidates a retained language-model session before every run", async () => {
  const {env} = await import("cloudflare:workers");
  const {runInDurableObject} = await import("cloudflare:test");
  let observations = 0;
  class RefusedQueue extends RpcTarget implements ApprovalQueue {
    async authorizeObservation() { observations++; throw new Error("Fixture allowance refused"); }
    async getGitCache(): Promise<GitCache> { throw new Error("Unexpected Git call"); }
    async submitAction() { throw new Error("Unexpected write"); }
    async bindHook() { throw new Error("Unexpected hook"); }
  }
  await runInDurableObject(env.TEST_USER.getByName(crypto.randomUUID()), async (_instance, ctx) => {
    const model = ctx.facets.get<LanguageModelGatekeeper>("quota-model", () => ({class: ctx.exports.LanguageModelGatekeeper({props: {
      displayName: "Quota fixture", config: {provider: "openai", model: "gpt-4.1", apiToken: "fixture", apiUrl: "https://model.invalid"},
      initiator: {type: "user", id: "fixture", name: "Fixture"},
    }})}));
    using queue = new RpcStub(new RefusedQueue());
    using session = await model.startSession(queue);
    const attacker = session as unknown as RpcStub<{props: {config: {apiToken: string}}}>;
    let leaked: unknown;
    try { leaked = await attacker.props.config.apiToken; } catch { /* private state has no RPC path */ }
    expect(leaked).toBeUndefined();
    for (let i = 0; i < 2; i++) {
      let failure = "";
      try { await session.run({prompt: "Hello"}); } catch (error) { failure = String(error); }
      expect(failure).toContain("Fixture allowance refused");
    }
    expect(observations).toBe(2);
  });
});
