import type { RpcTarget, WorkerEntrypoint } from "cloudflare:workers";

/** Deployment-owned resource dimensions; this is accounting data, never an identity selector. */
export type DeploymentUsage = Partial<Record<
    "modelRequests" | "tokens" | "capabilityCalls" | "externalRequests" |
    "pendingWrites" | "scheduledStarts", number>>;
export type UsageDecision = {allowed: true} | {allowed: false;
  reason: "daily_limit" | "run_limit" | "expired_run" | "concurrent_runs" | "unavailable";
  resource?: keyof DeploymentUsage};
export type UsageGrant = {allowed: true; runId: string; expiresAt: number};

/** Private adapter bound only to Workshop, with a previously verified exact storage key. */
export interface DeploymentUsagePolicy extends WorkerEntrypoint {
  beginRun(storageKey: string, runId: string): Promise<UsageGrant | Extract<UsageDecision, {allowed: false}>>;
  getRunGrant(storageKey: string, runId: string): Promise<UsageGrant | Extract<UsageDecision, {allowed: false}>>;
  reserve(storageKey: string, runId: string, requestId: string, usage: DeploymentUsage): Promise<UsageDecision>;
  settleTokens(storageKey: string, requestId: string, tokens: number): Promise<void>;
  finishRun(storageKey: string, runId: string): Promise<void>;
}

/**
 * One scoped run, offered only to trusted Gatekeeper implementations via their ApprovalQueue.
 * Never return this capability to Gadget code. Every actual dispatch needs a fresh reservation.
 * A borrowed agent scope's finish releases the lease, without finishing the parent agent run.
 */
export interface DeploymentUsageRun extends RpcTarget {
  getGrant(): Promise<UsageGrant>;
  reserve(usage: DeploymentUsage): Promise<string>;
  settleTokens(requestId: string, tokens: number): Promise<void>;
  finish(): Promise<void>;
}
