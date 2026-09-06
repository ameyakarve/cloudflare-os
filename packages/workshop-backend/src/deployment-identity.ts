import type { DeploymentAccountProvider, DeploymentIdentity } from '@gadgets/workshop-shared/gatekeeper';

/** Parse a private ingress identity without changing the canonical storage key. */
export function deploymentIdentity(storageKey: string | null): DeploymentIdentity {
  if (!storageKey || storageKey.length > 254 || /\s/.test(storageKey)) {
    throw new Error('Missing trusted deployment identity.');
  }
  return {subject: storageKey.includes('@') ? storageKey.toLowerCase() : storageKey, storageKey};
}

/** Resolve an explicitly configured private provider, independently of public vendor discovery. */
export function accountProvider(env: Cloudflare.Env, vendorId: string)
    : Pick<DeploymentAccountProvider, 'createAccount'> | undefined {
  let bindings = env as unknown as
      Partial<Record<string, Pick<DeploymentAccountProvider, 'createAccount'>>>;
  return bindings['ACCOUNT_PROVIDER_' + vendorId.toUpperCase()];
}
