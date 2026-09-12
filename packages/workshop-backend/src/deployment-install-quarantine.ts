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

/** One temporary destination fence, collected after the immutable admission deadline. */
export type InstallQuarantineRecord = {
  ticket: InstallQuarantineTicket;
  state: 'initializing' | 'initialized' | 'cancelled';
  workpieceId?: number;
};

/** Kernel-only durable key; absence does not authorize an installer admission. */
export const INSTALL_QUARANTINE_KEY = 'deployment-install-quarantine-v1';

/** Kernel-local symbol, not a string RPC method, flag, or public confirmation bypass. */
export const stageDeploymentInstallQuarantine = Symbol('stageDeploymentInstallQuarantine');
