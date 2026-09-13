import {RpcTarget, RpcStub} from 'cloudflare:workers';
import {validateRpc, skipRpcValidation} from 'capnweb-validate';
import type {NativePostOwnerCandidate} from '@gadgets/workshop-shared/deployment-native-post';
import type {DeploymentUsageRun} from '@gadgets/workshop-shared/deployment-usage';
import type {UserDurableObject} from './user.js';
import type {OverseerDurableObject} from './overseer.js';
import type {NativeHumanBoundContextV1} from '@gadgets/workshop-shared/os-native-post.generated';
import type {NativePostDeploymentFactory} from '@gadgets/workshop-shared/native-post-integration';

/** Local-only resolved envelope. Neither this symbol nor the guard is a host API. */
export const nativePostEnvelope = Symbol('nativePostEnvelope');

/** Kernel-local prerequisite, inaccessible by RPC string dispatch. Not Post authority. */
export const acquireNativePostContext = Symbol('acquireNativePostContext');
type OwnerQueue = Awaited<ReturnType<OverseerDurableObject['openNativePostOwnerQueue']>>;

/** Authenticated-root lifetime, constructed only by the actual root. No caller policy callback. */
export class NativePostRootLifetime {
  #closed = false;
  #contract: string | undefined;
  #renderer: string | undefined;
  #factory: Cloudflare.Env['NATIVE_POST_APPLICATION'];
  constructor(private env: Cloudflare.Env, private user: DurableObjectStub<UserDurableObject>,
      private overseers: DurableObjectNamespace<OverseerDurableObject>,
      private principal: string | undefined, private signal?: AbortSignal) {
    this.#contract = env.NATIVE_POST_CONTRACT_DIGEST;
    this.#renderer = env.NATIVE_POST_RENDERER_ARTIFACT_DIGEST;
    this.#factory = env.NATIVE_POST_APPLICATION;
  }
  /** Synchronous root/deployment fence, also checked after every awaited remote check. */
  checkCurrent(deadline: number) {
    if (this.#closed || this.signal?.aborted || !this.principal || Date.now() >= deadline ||
        this.env.NATIVE_POST_CONTRACT_DIGEST !== this.#contract ||
        this.env.NATIVE_POST_RENDERER_ARTIFACT_DIGEST !== this.#renderer || this.env.NATIVE_POST_APPLICATION !== this.#factory) throw new Error('Native Post is unavailable.');
  }
  /** New admissions additionally require the deployment gate. */
  check(deadline: number) {
    this.checkCurrent(deadline);
    if (this.env.NATIVE_POST_HUMAN_V2 !== 'true') throw new Error('Native Post is unavailable.');
  }
  /** Revokes locally. Existing acquired runs remain owned by the paired durable lifecycle. */
  close() { this.#closed = true; }
  /** Resolve a bounded candidate to the actual User and owner DO; never accepts a guard or namespace. */
  async acquire(candidate: NativePostOwnerCandidate, recoveryOnly = false): Promise<NativePostRootGuard> {
    // Fixed own-data projection before await. Unknown outer extras are ignored, not enumerated.
    const workspace = Object.getOwnPropertyDescriptor(candidate, 'workspaceId')?.value;
    const workpiece = Object.getOwnPropertyDescriptor(candidate, 'workpieceId')?.value;
    if (typeof workspace !== 'string' || !/^[a-f0-9]{64}$/.test(workspace) ||
        typeof workpiece !== 'string' || !/^[1-9][0-9]{0,14}$/.test(workpiece)) {
      throw new Error('Native Post is unavailable.');
    }
    const deadline = Date.now() + 900_000;
    const check = () => recoveryOnly ? this.checkCurrent(deadline) : this.check(deadline);
    check();
    const principal = this.principal!;
    const incarnation = await this.user.getNativePostIncarnation(principal, workspace);
    check();
    const owner = this.overseers.get(this.overseers.idFromString(workspace));
    const queue = await owner.openNativePostOwnerQueue(this.user.id.toString(), principal, Number(workpiece));
    const guard = new NativePostRootGuard(this, this.user, queue, principal, workspace, workpiece, incarnation, deadline, recoveryOnly);
    try { if (recoveryOnly) await guard.checkCurrent(); else await guard.checkActive(); check(); return guard; }
    catch (error) { guard[Symbol.dispose](); throw error; }
  }
}

/** Purpose-specific root/User/owner guard. W alone owns the exact one-use Post decision. */
@validateRpc()
export class NativePostRootGuard extends RpcTarget {
  #closed = false;
  #busy = false;
  constructor(private root: NativePostRootLifetime, private user: DurableObjectStub<UserDurableObject>,
      private queue: RpcStub<OwnerQueue>, private principal: string, private workspace: string,
      private workpiece: string, private incarnation: string, private deadline: number, private recoveryOnly: boolean) { super(); }
  #local() {
    if (this.#closed) throw new Error('Native Post is unavailable.');
    this.root.checkCurrent(this.deadline);
  }
  /** Root-owned identity and deployment pins; never read from the host candidate. */
  async [nativePostEnvelope](rootSessionId: string, rootGeneration: string, contractDigest: string, rendererArtifactDigest: string): Promise<NativeHumanBoundContextV1> {
    await this.checkCurrent();
    const resource = await this.queue.getNativeIdentity();
    await this.checkCurrent();
    return {owner: this.principal, deadline: this.deadline, identity: {
      principal: this.principal, userId: this.user.id.toString(), userIncarnation: this.incarnation,
      workspaceId: this.workspace, workpieceId: this.workpiece, ...resource,
      rootSessionId, rootGeneration, uiSessionGeneration: crypto.randomUUID(), contractDigest, rendererArtifactDigest,
    }};
  }
  /** Owner first, final authoritative User after its policy await, then local root/deadline.
   * Remote owner and identity replies are bounded fresh checks, NOT a distributed identity lock. */
  async checkCurrent(): Promise<void> {
    this.#local();
    await this.queue.checkCurrent(); this.#local();
    const until = await this.user.checkNativePostIdentity(this.principal, this.workspace, this.incarnation);
    this.#local();
    // Repeat owner after User's remote work; identity may still change after its reply.
    await this.queue.checkCurrent(); this.#local();
    if (Date.now() >= until) throw new Error('Native Post is unavailable.');
  }
  /** Admission fence includes both K root and actual owner deployment gates. */
  async checkActive(): Promise<void> {
    if (this.recoveryOnly) throw new Error('Native Post is unavailable.');
    this.root.check(this.deadline);
    await this.checkCurrent();
    await this.queue.checkActive();
    this.#local(); this.root.check(this.deadline);
  }
  /** Owning user-operation acquisition; never race away a returned root or lose failed-grant cleanup. */
  @skipRpcValidation()
  async getUsageBudget(...args: []): Promise<DeploymentUsageRun> {
    if (args.length || this.#busy) throw new Error('Native Post is unavailable.');
    this.#busy = true;
    // Include our own role/owner/grant work in the original five-second handoff window.
    const handoff = Date.now() + 5_000;
    let run: RpcStub<DeploymentUsageRun> | undefined;
    try {
      await this.checkActive();
      if (Date.now() >= handoff) throw new Error('Native Post is unavailable.');
      run = await this.queue.getUsageBudget();
      if (Date.now() >= handoff) throw new Error('Native Post is unavailable.');
      await this.checkActive();
      if (Date.now() >= handoff) throw new Error('Native Post is unavailable.');
      await run.getGrant();
      if (Date.now() >= handoff) throw new Error('Native Post is unavailable.');
      await this.checkActive();
      if (Date.now() >= handoff) throw new Error('Native Post is unavailable.');
      // Preserve all native methods; do not return-project or wrap an existing stub as a target.
      return run;
    } catch (error) {
      if (run) { try { await run.finish(); } finally { run[Symbol.dispose](); } }
      throw error;
    } finally { this.#busy = false; }
  }
  /** Revocation/disposal is not early finish of live work. The paired journal retains cleanup. */
  [Symbol.dispose]() { this.#closed = true; this.queue[Symbol.dispose](); }
}

declare global { namespace Cloudflare { interface Env {
  /** New exact deployment-owned native gate. Unset/non-'true' denies; never a Doctor flag. */
  NATIVE_POST_HUMAN_V2?: string;
  /** Reviewed compatibility selections, absent by default. Never host arguments. */
  NATIVE_POST_CONTRACT_DIGEST?: string;
  NATIVE_POST_RENDERER_ARTIFACT_DIGEST?: string;
  /** Private W factory binding; no namespace or issuer is returned to the host. */
  NATIVE_POST_APPLICATION?: RpcStub<NativePostDeploymentFactory>;
} } }
