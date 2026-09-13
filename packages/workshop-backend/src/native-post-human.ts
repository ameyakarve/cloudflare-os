import {RpcTarget, RpcStub} from 'cloudflare:workers';
import {validateRpc, skipRpcValidation} from 'capnweb-validate';
import type {NativePostOwnerCandidate} from '@gadgets/workshop-shared/deployment-native-post';
import type {DeploymentUsageRun} from '@gadgets/workshop-shared/deployment-usage';
import type {UserDurableObject} from './user.js';
import type {OverseerDurableObject} from './overseer.js';

/** Kernel-local prerequisite, inaccessible by RPC string dispatch. Not Post authority. */
export const acquireNativePostContext = Symbol('acquireNativePostContext');
type OwnerQueue = Awaited<ReturnType<OverseerDurableObject['openNativePostOwnerQueue']>>;

/** Authenticated-root lifetime, constructed only by the actual root. No caller policy callback. */
export class NativePostRootLifetime {
  #closed = false;
  constructor(private env: Cloudflare.Env, private user: DurableObjectStub<UserDurableObject>,
      private overseers: DurableObjectNamespace<OverseerDurableObject>,
      private principal: string | undefined, private signal?: AbortSignal) {}
  /** Synchronous root/deployment fence, also checked after every awaited remote check. */
  check(deadline: number) {
    if (this.#closed || this.signal?.aborted || this.env.NATIVE_POST_HUMAN_V2 !== 'true' ||
        !this.principal || Date.now() >= deadline) throw new Error('Native Post is unavailable.');
  }
  /** Revokes locally. Existing acquired runs remain owned by the paired durable lifecycle. */
  close() { this.#closed = true; }
  /** Resolve a bounded candidate to the actual User and owner DO; never accepts a guard or namespace. */
  async acquire(candidate: NativePostOwnerCandidate): Promise<NativePostRootGuard> {
    // Fixed own-data projection before await. Unknown outer extras are ignored, not enumerated.
    const workspace = Object.getOwnPropertyDescriptor(candidate, 'workspaceId')?.value;
    const workpiece = Object.getOwnPropertyDescriptor(candidate, 'workpieceId')?.value;
    if (typeof workspace !== 'string' || !/^[a-f0-9]{64}$/.test(workspace) ||
        typeof workpiece !== 'string' || !/^[1-9][0-9]{0,14}$/.test(workpiece)) {
      throw new Error('Native Post is unavailable.');
    }
    const deadline = Date.now() + 900_000;
    this.check(deadline);
    const principal = this.principal!;
    const incarnation = await this.user.getNativePostIncarnation(principal, workspace);
    this.check(deadline);
    const owner = this.overseers.get(this.overseers.idFromString(workspace));
    const queue = await owner.openNativePostOwnerQueue(this.user.id.toString(), principal, Number(workpiece));
    const guard = new NativePostRootGuard(this, this.user, queue, principal, workspace, incarnation, deadline);
    try { await guard.checkActive(); this.check(deadline); return guard; }
    catch (error) { guard[Symbol.dispose](); throw error; }
  }
}

/** Purpose-specific root/User/owner guard. Deliberately has no checkNativePost/approval method yet. */
@validateRpc()
export class NativePostRootGuard extends RpcTarget {
  #closed = false;
  #busy = false;
  constructor(private root: NativePostRootLifetime, private user: DurableObjectStub<UserDurableObject>,
      private queue: RpcStub<OwnerQueue>, private principal: string, private workspace: string,
      private incarnation: string, private deadline: number) { super(); }
  #local() {
    if (this.#closed) throw new Error('Native Post is unavailable.');
    this.root.check(this.deadline);
  }
  /** Owner first, final authoritative User after its policy await, then local root/deadline.
   * Remote owner and identity replies are bounded fresh checks, NOT a distributed identity lock. */
  async checkActive(): Promise<void> {
    this.#local();
    await this.queue.checkActive(); this.#local();
    const until = await this.user.checkNativePostIdentity(this.principal, this.workspace, this.incarnation);
    this.#local();
    // Repeat owner after User's remote work; identity may still change after its reply.
    await this.queue.checkActive(); this.#local();
    if (Date.now() >= until) throw new Error('Native Post is unavailable.');
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
} } }
