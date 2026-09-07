import { RpcTarget, type RpcStub } from "cloudflare:workers";
import type { DeploymentUsage, DeploymentUsagePolicy, DeploymentUsageRun, UsageGrant } from "@gadgets/workshop-shared/deployment-usage";

/** Expected refusal; distinguish quota control flow from provider incidents. */
export class DeploymentUsageError extends Error {
  constructor(reason = "unavailable") {
    super(`OS usage allowance ${reason.replaceAll("_", " ")}. Please retry later.`);
    this.name = "DeploymentUsageError";
  }
}

/** Native RPC preserves the error name even when it reconstructs the Error prototype. */
export function isDeploymentUsageError(error: unknown): error is DeploymentUsageError {
  return error instanceof DeploymentUsageError || error instanceof Error && error.name === "DeploymentUsageError";
}

/** Optional for upstream deployments; a required but absent binding must fail closed. */
export function deploymentUsageEnabled(env: Cloudflare.Env): boolean {
  return !!env.DEPLOYMENT_USAGE_POLICY || env.DEPLOYMENT_USAGE_REQUIRED === "true";
}

/** Bound private accounting RPC; late replies never authorize new work. */
export async function boundedUsage<T>(operation: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new DeploymentUsageError()), 5_000);
    })]);
  } finally { clearTimeout(timer); }
}

/** User-DO-owned capability with no arbitrary account selector. */
export class DeploymentUsageRunImpl extends RpcTarget implements DeploymentUsageRun {
  #finished = false;
  #receipts = new Set<string>();
  #policy: Service<DeploymentUsagePolicy>;
  #key: string;
  #grant: UsageGrant;
  #checkAccess: () => Promise<unknown>;
  constructor(policy: Service<DeploymentUsagePolicy>, key: string,
              grant: UsageGrant, checkAccess: () => Promise<unknown>) {
    super();
    this.#policy = policy; this.#key = key; this.#grant = grant;
    this.#checkAccess = checkAccess;
  }

  async getGrant(): Promise<UsageGrant> { this.#check(); return this.#grant; }
  async reserve(usage: DeploymentUsage): Promise<string> {
    this.#check();
    await boundedUsage(this.#checkAccess());
    this.#check();
    const requestId = crypto.randomUUID();
    const result = await boundedUsage((async () => await this.#policy.reserve(this.#key, this.#grant.runId, requestId, usage))());
    if (result?.allowed !== true) throw new DeploymentUsageError(result?.allowed === false ? result.reason : undefined);
    this.#check();
    this.#receipts.add(requestId);
    return requestId;
  }
  async settleTokens(requestId: string, tokens: number): Promise<void> {
    if (!this.#receipts.has(requestId)) throw new DeploymentUsageError();
    // Settlement may arrive after cancellation. It cannot authorize any further operation.
    await boundedUsage(this.#policy.settleTokens(this.#key, requestId, tokens));
  }
  async finish(): Promise<void> {
    if (this.#finished) return;
    this.#finished = true;
    await boundedUsage(this.#policy.finishRun(this.#key, this.#grant.runId));
  }
  #check() {
    if (this.#finished || this.#grant.expiresAt <= Date.now()) throw new DeploymentUsageError("expired_run");
  }
  // Losing a transient capability (e.g. an Overseer reset) does not finish its durable run.
  // Explicit finish closes normal work; a resumed turn reuses the grant, otherwise it expires.
}

/** A borrowed lease cannot finish its parent agent's run. */
class BorrowedUsageRun extends RpcTarget implements DeploymentUsageRun {
  #run: RpcStub<DeploymentUsageRun>;
  constructor(run: RpcStub<DeploymentUsageRun>) { super(); this.#run = run; }
  getGrant() { return this.#run.getGrant(); }
  reserve(usage: DeploymentUsage) { return this.#run.reserve(usage); }
  settleTokens(id: string, tokens: number) { return this.#run.settleTokens(id, tokens); }
  async finish() {}
  [Symbol.dispose]() { this.#run[Symbol.dispose](); }
}

/** Local lifetime/deadline companion; authority remains in the canonical quota store. */
export class UsageScope implements AsyncDisposable {
  readonly controller = new AbortController();
  #timer: ReturnType<typeof setTimeout>;
  #finished = false;
  private constructor(readonly run: RpcStub<DeploymentUsageRun>, readonly grant: UsageGrant) {
    this.#timer = setTimeout(() => this.controller.abort(new DeploymentUsageError("expired_run")),
        Math.max(0, grant.expiresAt - Date.now()));
  }
  static async open(run: RpcStub<DeploymentUsageRun>, expected?: UsageGrant): Promise<UsageScope> {
    try {
      const grant = await boundedUsage(run.getGrant());
      if (!grant || grant.allowed !== true || !Number.isSafeInteger(grant.expiresAt) ||
          grant.expiresAt <= Date.now() || grant.expiresAt > Date.now() + 900_000 ||
          (expected && (grant.runId !== expected.runId || grant.expiresAt !== expected.expiresAt))) {
        throw new DeploymentUsageError('expired_run');
      }
      return new UsageScope(run, grant);
    } catch (error) { run[Symbol.dispose](); throw error; }
  }
  borrow(): DeploymentUsageRun { return new BorrowedUsageRun(this.run.dup()); }
  async reserve(usage: DeploymentUsage): Promise<string> {
    this.controller.signal.throwIfAborted();
    const id = await boundedUsage(this.run.reserve(usage));
    this.controller.signal.throwIfAborted();
    return id;
  }
  async [Symbol.asyncDispose]() {
    if (this.#finished) return;
    this.#finished = true;
    clearTimeout(this.#timer);
    this.controller.abort(new DeploymentUsageError("expired_run"));
    try { await boundedUsage(this.run.finish()); } catch { /* expiry still bounds admission */ }
    finally { this.run[Symbol.dispose](); }
  }
}
