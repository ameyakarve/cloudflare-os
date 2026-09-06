import type { DeploymentAccessDecision, DeploymentAccessGrant } from "@gadgets/workshop-shared/deployment-access";

const MAX_GRANT_MS = 60_000;
const LOOKUP_TIMEOUT_MS = 5_000;

/** Expected policy refusal, suitable for display without disclosing membership data. */
export class DeploymentAccessError extends Error {
  constructor(readonly reason: "denied" | "unavailable" = "unavailable") {
    super(reason === "denied" ? "Your access to this workspace is no longer active."
        : "Access could not be verified. Please retry shortly.");
    this.name = "DeploymentAccessError";
  }
}

/** Whether this deployment requires runtime checks; absent optional policy preserves upstream behavior. */
export function deploymentAccessEnabled(env: Cloudflare.Env): boolean {
  return !!env.DEPLOYMENT_ACCESS_POLICY || env.DEPLOYMENT_ACCESS_REQUIRED === "true";
}

/** Bound a private policy RPC independently of the provider's response. */
async function boundedCheck<T>(check: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  let abort: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([check(), new Promise<never>((_, reject) => {
      abort = () => reject(new DeploymentAccessError());
      timer = setTimeout(abort, LOOKUP_TIMEOUT_MS);
      signal?.addEventListener("abort", abort, {once: true});
    })]);
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}

/** Read a fresh grant using only stored/trusted identity; failures never extend an earlier grant. */
export async function readDeploymentAccess(
    env: Cloudflare.Env, storageKey: string | undefined): Promise<DeploymentAccessGrant | undefined> {
  if (!deploymentAccessEnabled(env)) return undefined;
  if (!storageKey || !env.DEPLOYMENT_ACCESS_POLICY) throw new DeploymentAccessError();
  const startedAt = Date.now();
  try {
    const decision = await boundedCheck<DeploymentAccessDecision>(async () => await env.DEPLOYMENT_ACCESS_POLICY!.checkAccess(storageKey));
    if (decision?.allowed === false) throw new DeploymentAccessError(decision.reason);
    if (decision?.allowed !== true || !Number.isFinite(decision.validUntil) || decision.validUntil <= Date.now()) {
      throw new DeploymentAccessError();
    }
    return { allowed: true, validUntil: Math.min(decision.validUntil, startedAt + MAX_GRANT_MS) };
  } catch (error) {
    if (error instanceof DeploymentAccessError) throw error;
    throw new DeploymentAccessError();
  }
}

/**
 * Renew authorization before expiry while a socket or agent run is alive. The independent expiry
 * timer stops use even if renewal hangs. Dispose on completion/disconnect; late replies are ignored.
 */
export async function watchDeploymentAccess(
    check: () => Promise<DeploymentAccessGrant | undefined>,
    revoke: (error: DeploymentAccessError) => void): Promise<Disposable> {
  let stopped = false;
  const pending = new AbortController();
  let renewal: ReturnType<typeof setTimeout> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { stopped = true; clearTimeout(renewal); clearTimeout(expiry); pending.abort(); };
  const fail = (error: unknown) => {
    if (stopped) return;
    stop();
    revoke(error instanceof DeploymentAccessError ? error : new DeploymentAccessError());
  };
  const schedule = (grant: DeploymentAccessGrant | undefined) => {
    if (stopped || !grant) return;
    const remaining = Math.min(grant.validUntil - Date.now(), MAX_GRANT_MS);
    if (remaining <= 0) throw new DeploymentAccessError();
    clearTimeout(expiry);
    expiry = setTimeout(() => fail(new DeploymentAccessError()), remaining);
    renewal = setTimeout(() => {
      boundedCheck(check, pending.signal).then(schedule, fail).catch(fail);
    }, Math.max(1, remaining - Math.min(LOOKUP_TIMEOUT_MS, remaining / 2)));
  };
  // Initial failure is a refused operation, not an asynchronously revoked one.
  schedule(await boundedCheck(check));
  return { [Symbol.dispose]: stop };
}
