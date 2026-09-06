import type { WorkerEntrypoint } from "cloudflare:workers";

/** Positive authorization that the runtime must stop using at validUntil (epoch milliseconds). */
export type DeploymentAccessGrant = { allowed: true; validUntil: number };

/** Private deployment decision; unavailable must never be treated as an affirmative grant. */
export type DeploymentAccessDecision = DeploymentAccessGrant |
    { allowed: false; reason: "denied" | "unavailable" };

/**
 * Optional deployment policy, bound privately as DEPLOYMENT_ACCESS_POLICY. The runtime supplies
 * a previously verified storage key; neither agents nor browser arguments select this identity.
 * This service is not a Gatekeeper vendor or a capability offered to Gadget code.
 */
export interface DeploymentAccessPolicy extends WorkerEntrypoint {
  /** Read current entitlement and issue a positive grant lasting at most one minute. */
  checkAccess(storageKey: string): Promise<DeploymentAccessDecision>;
}
