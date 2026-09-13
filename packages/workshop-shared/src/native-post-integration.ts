import type {RpcTarget} from 'capnweb';
import type {DeploymentUsageRun} from './deployment-usage.js';
import type {NativeHumanBoundContextV1, NativeHumanOpenV1, NativePostCanonicalApi} from './os-native-post.generated';

/** Native-only host protocol. W tokens, not M decision IDs, are confirmation authority. */
export interface NativePostSession extends RpcTarget, Omit<NativePostCanonicalApi, 'confirm' | 'reviewPrepared'> {
  /** Consume one W-issued token, including failed confirmation attempts. */
  confirm(token: string): ReturnType<NativePostCanonicalApi['confirm']>;
  /** Complete admitted M response with a separate, one-use W decision token. */
  reviewPrepared(handle: Parameters<NativePostCanonicalApi['reviewPrepared']>[0]): Promise<
    Exclude<Awaited<ReturnType<NativePostCanonicalApi['reviewPrepared']>>, {ok: true}> |
    {ok: true; value: {token: string; response: Extract<Awaited<ReturnType<NativePostCanonicalApi['reviewPrepared']>>, {ok: true}>['value']}}>
}

/** Purpose-specific K capability, supplied only by the authenticated-root factory. */
export interface NativePostRoot extends RpcTarget {
  /** Current root/User/owner/resource authority, including recovery while admission is OFF. */
  checkCurrent(): Promise<void>;
  /** Current authority plus exact deployment-owned new-admission gate. */
  checkActive(): Promise<void>;
  /** Acquire the actual owning paired user-operation run, retaining native methods. */
  getUsageBudget(): Promise<DeploymentUsageRun>;
}

/** Deployment-private W entrypoint; never placed in host/agent/resource APIs. */
export interface NativePostDeploymentFactory extends RpcTarget {
  /** K supplies the resolved context and root together; W independently checks its pins/gate. */
  openNativePost(context: NativeHumanBoundContextV1, request: NativeHumanOpenV1, root: NativePostRoot): Promise<NativePostSession | null>;
}
