/** Private DO admission tuple. Never accepted from an authenticated RPC client. */
export type InstallQuarantineTicket = {
  ownerId: string;
  session: string;
  attempt: string;
  digest: string;
  principal: string;
  incarnation: string;
  expiresAt: number;
  workspaceId: string;
};

/** Destination fence: uncommitted state expires; a published marker lives with its workspace. */
export type InstallQuarantineRecord = {
  ticket: InstallQuarantineTicket;
  state: 'initializing' | 'initialized' | 'ready' | 'published' | 'cancelled';
  workpieceId?: number;
  releaseId?: string;
  uiSha256?: string;
};

/** Kernel-only durable key; absence does not authorize an installer admission. */
export const INSTALL_QUARANTINE_KEY = 'deployment-install-quarantine-v1';

/** Kernel-local symbol, not a string RPC method, flag, or public confirmation bypass. */
export const stageDeploymentInstallQuarantine = Symbol('stageDeploymentInstallQuarantine');

/** Trusted backend composition only; deliberately absent from public confirmation and RPC. */
export const publishDeploymentInstall = Symbol('publishDeploymentInstall');
